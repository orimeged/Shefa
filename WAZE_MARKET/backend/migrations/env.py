"""Runs migrations on the app's connection, or on DATABASE_URL from the command line."""

from alembic import context

from app.config import Settings
from app.repositories.database import create_database_engine
from app.repositories.inventory_tables import Base


def run(connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=Base.metadata,
        # SQLite can't alter a column in place, so Alembic rebuilds the table instead.
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()


connection = context.config.attributes.get("connection")
if connection is not None:
    run(connection)
else:
    with create_database_engine(Settings.from_env().database_url).connect() as opened:
        run(opened)
        opened.commit()
