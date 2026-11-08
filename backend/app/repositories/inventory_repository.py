"""Inventory in the database: zones, what stands in them, and what shoppers see of it."""

from collections import defaultdict
from collections.abc import Collection, Iterable, Iterator, Sequence
from contextlib import contextmanager
from datetime import UTC, datetime

from sqlalchemy import Engine, delete, func, select, update
from sqlalchemy.orm import Session

from app.domain import models
from app.domain.inventory import (
    CatalogCategory,
    CatalogEntry,
    CatalogRow,
    EntityType,
    InvalidItemError,
    InventoryError,
    LayoutConflictError,
    StagedItem,
    Zone,
    ZoneItem,
)
from app.domain.search_text import normalize
from app.repositories.inventory_tables import Category, MapNode, NodeAssignment, Product, StoreRecord

_SIDE_NAMES = {models.Side.LEFT: "שמאל", models.Side.RIGHT: "ימין"}
_PRODUCT_STOP_PREFIX = "product-"
_POS_SOURCE = "pos"


def zone_element_id(section_id: str) -> str:
    """The DOM id of a zone. buildMapLayout in the frontend draws the same one."""
    return f"zone-{section_id}"


def product_stop_id(product_id: int) -> str:
    return f"{_PRODUCT_STOP_PREFIX}{product_id}"


def _product_id_of(stop_id: str) -> int | None:
    number = stop_id.removeprefix(_PRODUCT_STOP_PREFIX)
    return int(number) if number != stop_id and number.isdecimal() else None


def _zone_names(layout: models.Store) -> dict[str, str]:
    """"מעבר 2, ימין, מדף 3", counting from the store front along each side of an aisle."""
    heights = {node.id: node.y for node in layout.nodes}
    faces: dict[tuple[int, models.Side], list[models.Section]] = defaultdict(list)
    for section in layout.sections:
        faces[section.aisle_no, section.side].append(section)
    return {
        section.id: f"מעבר {aisle_no}, {_SIDE_NAMES[side]}, מדף {bay}"
        for (aisle_no, side), sections in faces.items()
        for bay, section in enumerate(
            sorted(sections, key=lambda candidate: heights[candidate.node_id]), start=1
        )
    }


def _zone_label(items: Sequence[ZoneItem]) -> ZoneItem | None:
    """A department placed here says it best. Otherwise, whatever the products belong to."""
    departments = (item for item in items if item.entity_type is EntityType.CATEGORY)
    return next(departments, items[0] if items else None)


class SqlInventoryRepository:
    def __init__(self, engine: Engine) -> None:
        self._engine = engine

    @contextmanager
    def _writing(self, store_id: str) -> Iterator[Session]:
        """One transaction, rolled back whole on any error.

        It opens with the version write so that it holds the lock from the start:
        two managers saving at once take turns instead of one failing halfway.
        """
        with Session(self._engine) as session, session.begin():
            result = session.execute(
                update(StoreRecord)
                .where(StoreRecord.id == store_id)
                .values(version=StoreRecord.version + 1)
            )
            if result.rowcount != 1:
                raise InventoryError(f"Unknown store: {store_id}")
            yield session

    def sync_layout(self, layout: models.Store) -> None:
        """Brings zones in line with the floor plan, at startup.

        The plan is ours, so its zones always win. Categories and products are only
        copied in once, because from then on they belong to the store's managers.
        """
        with Session(self._engine) as session, session.begin():
            is_new = session.get(StoreRecord, layout.id) is None
            if is_new:
                session.add(StoreRecord(id=layout.id))
                session.flush()
            nodes = self._sync_zones(session, layout)
            if is_new:
                self._seed_inventory(session, layout, nodes)

    @staticmethod
    def _sync_zones(session: Session, layout: models.Store) -> dict[str, MapNode]:
        existing = {
            node.section_id: node
            for node in session.scalars(select(MapNode).where(MapNode.store_id == layout.id))
        }
        points = {node.id: node for node in layout.nodes}
        names = _zone_names(layout)
        nodes: dict[str, MapNode] = {}
        for section in layout.sections:
            node = existing.pop(section.id, None)
            if node is None:
                node = MapNode(store_id=layout.id, section_id=section.id)
                session.add(node)
            point = points[section.node_id]
            node.zone_name = names[section.id]
            node.svg_element_id = zone_element_id(section.id)
            node.x = point.x
            node.y = point.y
            nodes[section.id] = node

        for gone in existing.values():
            held = select(NodeAssignment).where(NodeAssignment.node_id == gone.id).limit(1)
            if session.scalar(held) is not None:
                # Dropping it would silently erase what a manager put there.
                raise LayoutConflictError(
                    f"{layout.id}: {gone.section_id} left the floor plan but still holds items"
                )
            session.delete(gone)
        session.flush()
        return nodes

    @staticmethod
    def _seed_inventory(
        session: Session, layout: models.Store, nodes: dict[str, MapNode]
    ) -> None:
        categories = {
            category.id: Category(
                store_id=layout.id,
                slug=category.id,
                name=category.name,
                name_en=category.name_en,
                aliases=list(category.aliases),
            )
            for category in layout.categories
        }
        session.add_all(categories.values())
        session.flush()
        session.add_all(
            Product(
                store_id=layout.id,
                name=product.name,
                name_key=normalize(product.name),
                category_id=categories[product.category_id].id,
                barcode=product.barcode,
            )
            for product in layout.products
        )
        now = datetime.now(UTC)
        session.add_all(
            NodeAssignment(
                node_id=nodes[category.section_id].id,
                entity_type=EntityType.CATEGORY.value,
                entity_id=categories[category.id].id,
                assigned_at=now,
            )
            for category in layout.categories
        )

    def version(self, store_id: str) -> int | None:
        with self._engine.connect() as connection:
            return connection.scalar(select(StoreRecord.version).where(StoreRecord.id == store_id))

    def shopper_store(self, layout: models.Store) -> models.Store:
        """The floor plan with today's inventory on it.

        A category with no zone is left out, so search says the store doesn't have
        it rather than naming a shelf nobody can vouch for. A product with its own
        zone becomes a stop of its own. Any other product stands with its category.
        """
        with Session(self._engine) as session:
            sections_of = self._sections_by_entity(session, layout.id)
            categories = session.scalars(
                select(Category).where(Category.store_id == layout.id).order_by(Category.id)
            ).all()
            products = session.scalars(
                select(Product).where(Product.store_id == layout.id).order_by(Product.id)
            ).all()

        slugs = {category.id: category.slug for category in categories}
        departments = [
            models.Category(
                id=category.slug,
                name=category.name,
                name_en=category.name_en,
                section_id=sections[0],
                other_section_ids=tuple(sections[1:]),
                aliases=tuple(category.aliases),
            )
            for category in categories
            if (sections := sections_of.get((EntityType.CATEGORY, category.id)))
        ]
        located = {department.id for department in departments}

        stops: list[models.Category] = []
        shelved: list[models.Product] = []
        for product in products:
            department = slugs[product.category_id]
            sections = sections_of.get((EntityType.PRODUCT, product.id))
            if sections:
                stops.append(
                    models.Category(
                        id=product_stop_id(product.id),
                        name=product.name,
                        name_en=product.name,
                        section_id=sections[0],
                        other_section_ids=tuple(sections[1:]),
                        department_id=department,
                    )
                )
            elif department in located:
                shelved.append(
                    models.Product(
                        barcode=product.barcode or product_stop_id(product.id),
                        name=product.name,
                        category_id=department,
                    )
                )

        return models.Store(
            id=layout.id,
            name=layout.name,
            width_m=layout.width_m,
            height_m=layout.height_m,
            nodes=layout.nodes,
            edges=layout.edges,
            sections=layout.sections,
            categories=tuple(departments),
            product_stops=tuple(stops),
            products=tuple(shelved),
        )

    @staticmethod
    def _sections_by_entity(
        session: Session, store_id: str
    ) -> dict[tuple[EntityType, int], list[str]]:
        rows = session.execute(
            select(NodeAssignment.entity_type, NodeAssignment.entity_id, MapNode.section_id)
            .join(MapNode, NodeAssignment.node_id == MapNode.id)
            .where(MapNode.store_id == store_id)
            # The first zone is the one search names, and it shouldn't change at random.
            .order_by(NodeAssignment.assigned_at, MapNode.id)
        ).all()
        sections: dict[tuple[EntityType, int], list[str]] = defaultdict(list)
        for entity_type, entity_id, section_id in rows:
            sections[EntityType(entity_type), entity_id].append(section_id)
        return sections

    def zones(self, store_id: str) -> list[Zone]:
        with Session(self._engine) as session:
            self._require_store(session, store_id)
            nodes = session.scalars(
                select(MapNode).where(MapNode.store_id == store_id).order_by(MapNode.id)
            ).all()
            items = self._items_by_node(session, store_id)
        zones = []
        for node in nodes:
            label = _zone_label(items[node.id])
            zones.append(
                Zone(
                    id=node.id,
                    zone_name=node.zone_name,
                    svg_element_id=node.svg_element_id,
                    section_id=node.section_id,
                    x=node.x,
                    y=node.y,
                    item_count=len(items[node.id]),
                    preview=label.category_name if label else None,
                    preview_en=label.category_name_en if label else None,
                )
            )
        return zones

    def categories(self, store_id: str) -> list[CatalogCategory]:
        with Session(self._engine) as session:
            self._require_store(session, store_id)
            rows = session.scalars(
                select(Category).where(Category.store_id == store_id).order_by(Category.name)
            ).all()
        return [
            CatalogCategory(id=row.id, slug=row.slug, name=row.name, name_en=row.name_en)
            for row in rows
        ]

    def departments_of(
        self, store_id: str, target_ids: Iterable[str]
    ) -> dict[str, CatalogCategory]:
        """The department of each route target, the ids shoppers' reports carry."""
        ids = set(target_ids)
        product_ids = {
            product_id
            for target_id in ids
            if (product_id := _product_id_of(target_id)) is not None
        }
        with Session(self._engine) as session:
            categories = session.scalars(
                select(Category).where(Category.store_id == store_id)
            ).all()
            departments = dict(
                session.execute(
                    select(Product.id, Product.category_id).where(
                        Product.store_id == store_id, Product.id.in_(product_ids)
                    )
                ).all()
            )

        by_id = {category.id: category for category in categories}
        by_target = {category.slug: category for category in categories}
        by_target |= {
            product_stop_id(product_id): by_id[category_id]
            for product_id, category_id in departments.items()
        }
        return {
            target_id: CatalogCategory(
                id=category.id, slug=category.slug, name=category.name, name_en=category.name_en
            )
            for target_id in ids
            if (category := by_target.get(target_id)) is not None
        }

    def search_catalog(self, store_id: str, query: str, limit: int) -> list[CatalogEntry]:
        """Departments first: "dairy" more likely means the department than a product."""
        key = normalize(query)
        if not key:
            return []
        with Session(self._engine) as session:
            self._require_store(session, store_id)
            categories = session.scalars(
                select(Category).where(Category.store_id == store_id).order_by(Category.name)
            ).all()
            names = {category.id: category.name for category in categories}
            entries = [
                CatalogEntry(
                    entity_type=EntityType.CATEGORY,
                    entity_id=category.id,
                    name=category.name,
                    category_name=category.name,
                )
                for category in categories
                if key in normalize(category.name) or key in normalize(category.name_en)
            ]
            products = session.scalars(
                select(Product)
                .where(Product.store_id == store_id, Product.name_key.contains(key, autoescape=True))
                .order_by(Product.name)
                .limit(limit)
            ).all()
        entries += [
            CatalogEntry(
                entity_type=EntityType.PRODUCT,
                entity_id=product.id,
                name=product.name,
                category_name=names[product.category_id],
            )
            for product in products
        ]
        return entries[:limit]

    def zone_items(self, store_id: str, node_id: int) -> list[ZoneItem]:
        with Session(self._engine) as session:
            self._require_store(session, store_id)
            self._require_node(session, store_id, node_id)
            return self._items_by_node(session, store_id, node_id)[node_id]

    def assign(
        self,
        store_id: str,
        node_id: int,
        entity_type: EntityType,
        entity_id: int,
        *,
        relocate: bool = False,
    ) -> list[ZoneItem]:
        with self._writing(store_id) as session:
            self._require_node(session, store_id, node_id)
            self._require_entity(session, store_id, entity_type, entity_id)
            self._place(session, node_id, entity_type, entity_id)
            if relocate and entity_type is EntityType.PRODUCT:
                self._clear_other_zones(session, node_id, entity_id)
            return self._items_by_node(session, store_id, node_id)[node_id]

    def assign_batch(
        self,
        store_id: str,
        node_id: int,
        items: Sequence[StagedItem],
        *,
        relocate: bool = False,
    ) -> list[ZoneItem]:
        """All of an approved list or none of it, and safe to send twice.

        `relocate` only moves products: a department can rightly span several zones,
        and one item's alert is no reason to pull it off them.
        """
        with self._writing(store_id) as session:
            self._require_node(session, store_id, node_id)
            categories = {
                category.id: category
                for category in session.scalars(
                    select(Category).where(Category.store_id == store_id)
                )
            }
            by_name = {normalize(category.name): category for category in categories.values()}

            for item in items:
                category = categories.get(item.category_id)
                if category is None:
                    raise InvalidItemError(f"Unknown category: {item.category_id}")
                key = normalize(item.name)
                if not key:
                    raise InvalidItemError(f"Not a product name: {item.name}")
                if key in by_name:
                    # Saying a department's name means the department.
                    self._place(session, node_id, EntityType.CATEGORY, by_name[key].id)
                    continue
                product = self._find_or_create_product(session, store_id, item.name, key)
                # The manager just approved this category, so it's the newest word on it.
                product.category_id = category.id
                session.flush()
                self._place(session, node_id, EntityType.PRODUCT, product.id)
                if relocate:
                    self._clear_other_zones(session, node_id, product.id)
            return self._items_by_node(session, store_id, node_id)[node_id]

    @staticmethod
    def _clear_other_zones(session: Session, node_id: int, product_id: int) -> None:
        """Routing goes to the closest place, which could still be the shelf it left."""
        session.execute(
            delete(NodeAssignment).where(
                NodeAssignment.entity_type == EntityType.PRODUCT.value,
                NodeAssignment.entity_id == product_id,
                NodeAssignment.node_id != node_id,
            )
        )

    def import_catalog(
        self,
        store_id: str,
        rows: Sequence[CatalogRow],
        retire_barcodes: Collection[str] = (),
    ) -> None:
        """Makes the store's catalog match a point-of-sale export, all of it or none.

        A row is found by barcode, or by name when a manager already added the
        product by hand, and its zone becomes the only place it stands. Whatever
        an earlier import brought and this one lacks is gone from the store.
        `retire_barcodes` names placeholder products to drop, unless a manager has
        placed them, since that makes them the manager's.
        """
        with self._writing(store_id) as session:
            categories = {
                category.slug: category
                for category in session.scalars(
                    select(Category).where(Category.store_id == store_id)
                )
            }
            zones = {
                node.section_id: node
                for node in session.scalars(select(MapNode).where(MapNode.store_id == store_id))
            }
            existing = list(session.scalars(select(Product).where(Product.store_id == store_id)))
            by_barcode = {product.barcode: product for product in existing if product.barcode}
            by_name = {product.name_key: product for product in existing}

            imported: set[int] = set()
            for row in rows:
                if row.department not in categories:
                    raise InvalidItemError(f"Unknown department: {row.department}")
                if row.zone not in zones:
                    raise InvalidItemError(f"Unknown zone: {row.zone}")
                key = normalize(row.display_name)
                product = by_barcode.get(row.barcode) or by_name.get(key)
                if product is None:
                    product = Product(store_id=store_id)
                    session.add(product)
                product.name = row.display_name
                product.name_key = key
                product.barcode = row.barcode
                product.brand = row.brand
                product.size = row.size
                product.subcategory = row.subcategory
                product.source = _POS_SOURCE
                product.category_id = categories[row.department].id
                session.flush()

                self._place(session, zones[row.zone].id, EntityType.PRODUCT, product.id)
                self._clear_other_zones(session, zones[row.zone].id, product.id)
                imported.add(product.id)

            placed = set(
                session.scalars(
                    select(NodeAssignment.entity_id).where(
                        NodeAssignment.entity_type == EntityType.PRODUCT.value
                    )
                )
            )
            dropped = [
                product.id
                for product in existing
                if product.id not in imported
                and (
                    product.source == _POS_SOURCE
                    or (product.barcode in retire_barcodes and product.id not in placed)
                )
            ]
            self._delete_products(session, dropped)

    def remove_imported_catalog(self, layout: models.Store) -> None:
        """Undoes imports, and puts back the floor plan's placeholders they retired."""
        with self._writing(layout.id) as session:
            imported = session.scalars(
                select(Product.id).where(
                    Product.store_id == layout.id, Product.source == _POS_SOURCE
                )
            ).all()
            self._delete_products(session, imported)

            known = set(
                session.scalars(select(Product.barcode).where(Product.store_id == layout.id))
            )
            categories = {
                category.slug: category.id
                for category in session.scalars(
                    select(Category).where(Category.store_id == layout.id)
                )
            }
            session.add_all(
                Product(
                    store_id=layout.id,
                    name=product.name,
                    name_key=normalize(product.name),
                    category_id=categories[product.category_id],
                    barcode=product.barcode,
                )
                for product in layout.products
                if product.barcode not in known
            )

    @staticmethod
    def _delete_products(session: Session, product_ids: Sequence[int]) -> None:
        """Assignments go first: their entity_id can't be a foreign key that would do it."""
        session.execute(
            delete(NodeAssignment).where(
                NodeAssignment.entity_type == EntityType.PRODUCT.value,
                NodeAssignment.entity_id.in_(product_ids),
            )
        )
        session.execute(delete(Product).where(Product.id.in_(product_ids)))

    @staticmethod
    def _find_or_create_product(session: Session, store_id: str, name: str, key: str) -> Product:
        product = session.scalar(
            select(Product).where(Product.store_id == store_id, Product.name_key == key)
        )
        if product is None:
            product = Product(store_id=store_id, name=name, name_key=key)
            session.add(product)
        return product

    def move(
        self,
        store_id: str,
        node_id: int,
        entity_type: EntityType,
        entity_id: int,
        to_node_id: int,
    ) -> list[ZoneItem]:
        with self._writing(store_id) as session:
            self._require_node(session, store_id, node_id)
            self._require_node(session, store_id, to_node_id)
            assignment = self._require_assignment(session, node_id, entity_type, entity_id)
            if to_node_id != node_id:
                session.delete(assignment)
                session.flush()
                self._place(session, to_node_id, entity_type, entity_id)
            return self._items_by_node(session, store_id, node_id)[node_id]

    def unassign(
        self, store_id: str, node_id: int, entity_type: EntityType, entity_id: int
    ) -> None:
        with self._writing(store_id) as session:
            self._require_node(session, store_id, node_id)
            session.delete(self._require_assignment(session, node_id, entity_type, entity_id))

    @staticmethod
    def _place(session: Session, node_id: int, entity_type: EntityType, entity_id: int) -> None:
        key = (node_id, entity_type.value, entity_id)
        if session.get(NodeAssignment, key) is None:
            session.add(
                NodeAssignment(
                    node_id=node_id,
                    entity_type=entity_type.value,
                    entity_id=entity_id,
                    assigned_at=datetime.now(UTC),
                )
            )
            session.flush()

    @staticmethod
    def _items_by_node(
        session: Session, store_id: str, node_id: int | None = None
    ) -> dict[int, list[ZoneItem]]:
        statement = (
            select(NodeAssignment)
            .join(MapNode, NodeAssignment.node_id == MapNode.id)
            .where(MapNode.store_id == store_id)
            .order_by(NodeAssignment.assigned_at, NodeAssignment.entity_id)
        )
        if node_id is not None:
            statement = statement.where(NodeAssignment.node_id == node_id)
        assignments = session.scalars(statement).all()

        categories = {
            category.id: category
            for category in session.scalars(select(Category).where(Category.store_id == store_id))
        }
        product_ids = [
            row.entity_id for row in assignments if row.entity_type == EntityType.PRODUCT
        ]
        products = {
            product.id: product
            for product in session.scalars(select(Product).where(Product.id.in_(product_ids)))
        }
        counts = dict(
            session.execute(
                select(Product.category_id, func.count())
                .where(Product.store_id == store_id)
                .group_by(Product.category_id)
            ).all()
        )

        items: dict[int, list[ZoneItem]] = defaultdict(list)
        for row in assignments:
            entity_type = EntityType(row.entity_type)
            if entity_type is EntityType.CATEGORY:
                category = categories[row.entity_id]
                item = ZoneItem(
                    entity_type=entity_type,
                    entity_id=row.entity_id,
                    name=category.name,
                    category_name=category.name,
                    category_name_en=category.name_en,
                    product_count=counts.get(category.id, 0),
                )
            else:
                product = products[row.entity_id]
                department = categories[product.category_id]
                item = ZoneItem(
                    entity_type=entity_type,
                    entity_id=row.entity_id,
                    name=product.name,
                    category_name=department.name,
                    category_name_en=department.name_en,
                    subcategory=product.subcategory,
                    barcode=product.barcode,
                )
            items[row.node_id].append(item)
        return items

    @staticmethod
    def _require_store(session: Session, store_id: str) -> None:
        if session.get(StoreRecord, store_id) is None:
            raise InventoryError(f"Unknown store: {store_id}")

    @staticmethod
    def _require_node(session: Session, store_id: str, node_id: int) -> None:
        node = session.get(MapNode, node_id)
        if node is None or node.store_id != store_id:
            raise InventoryError(f"Unknown zone: {node_id}")

    @staticmethod
    def _require_entity(
        session: Session, store_id: str, entity_type: EntityType, entity_id: int
    ) -> None:
        table = Category if entity_type is EntityType.CATEGORY else Product
        entity = session.get(table, entity_id)
        if entity is None or entity.store_id != store_id:
            raise InventoryError(f"Unknown {entity_type.value}: {entity_id}")

    @staticmethod
    def _require_assignment(
        session: Session, node_id: int, entity_type: EntityType, entity_id: int
    ) -> NodeAssignment:
        assignment = session.get(NodeAssignment, (node_id, entity_type.value, entity_id))
        if assignment is None:
            raise InventoryError(f"Not in zone {node_id}: {entity_type.value} {entity_id}")
        return assignment
