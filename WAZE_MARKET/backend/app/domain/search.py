"""Hebrew-aware category search over names, aliases, products and the food dictionary."""

from collections.abc import Callable
from dataclasses import dataclass
from difflib import SequenceMatcher

from app.domain.dictionary import FoodDictionary
from app.domain.models import Store
from app.domain.search_text import normalize

_MIN_FUZZY_RATIO = 0.75
_MIN_SHARED_LETTERS = 0.6
_MIN_WORD_SCORE = 0.55
_MIN_PHRASE_SCORE = 0.8
_MAX_PHRASE_WORDS = 3
# In a long dictionary a short word is one letter away from something unrelated,
# so short list items need a real match, and two letters need an exact one.
_MIN_FUZZY_LENGTH = 5
_MIN_SUBSTRING_LENGTH = 3
# Exact and prefix matches. Anything weaker is a guess worth a second opinion.
_CONFIDENT_SCORE = 0.9
_AND_PREFIX = "ו"


@dataclass(frozen=True, slots=True)
class SearchMatch:
    category_id: str
    matched_text: str
    score: float
    dictionary_id: str | None = None


@dataclass(slots=True)
class ResolvedPart:
    text: str
    match: SearchMatch | None
    # True when the match is a guess or swallowed words it couldn't place.
    uncertain: bool = False


@dataclass(frozen=True, slots=True)
class _Word:
    text: str
    letters: frozenset[str]


@dataclass(frozen=True, slots=True)
class _Term:
    normalized: str
    words: tuple[str, ...]
    fuzzy_targets: tuple[_Word, ...]
    text: str
    category_id: str
    dictionary_id: str | None


def _fuzzy_ratio(query: str, letters: frozenset[str], word: _Word) -> float:
    # Counting shared letters is cheap and rules out nearly every word in the
    # dictionary. The bar is below the real one because letters can repeat.
    if 2 * len(letters & word.letters) / (len(query) + len(word.text)) < _MIN_SHARED_LETTERS:
        return 0.0
    return SequenceMatcher(None, query, word.text).ratio()


def _direct_score(query: str, term: _Term) -> float:
    normalized = term.normalized
    if query == normalized:
        return 1.0
    if normalized.startswith(query):
        return 0.95
    if any(word.startswith(query) for word in term.words):
        # A whole word of the name, "פיצה" in "בצק פיצה", is as good as its start.
        # Only the start of a longer word, "יום" in "יומיות", is a guess.
        return 0.9 if query in term.words else 0.85
    return 0.8 if query in normalized else 0.0


def _fuzzy_score(query: str, letters: frozenset[str], term: _Term) -> float:
    ratio = max(_fuzzy_ratio(query, letters, word) for word in term.fuzzy_targets)
    return round(ratio * 0.75, 3) if ratio >= _MIN_FUZZY_RATIO else 0.0


class CategorySearch:
    def __init__(self, store: Store, dictionary: FoodDictionary | None = None) -> None:
        # Earlier terms win a tie: a product a manager placed beats the department
        # it'd otherwise fall under, and the store's names beat the general dictionary.
        sources: list[tuple[str, str, str | None]] = [
            (text, category.id, None)
            for category in (*store.product_stops, *store.categories)
            for text in (category.name, category.name_en, *category.aliases)
        ]
        sources += [(product.name, product.category_id, None) for product in store.products]
        if dictionary:
            sources += list(dictionary.terms())
        self._terms = tuple(self._term(*source) for source in sources)

    @staticmethod
    def _term(text: str, category_id: str, dictionary_id: str | None) -> _Term:
        normalized = normalize(text)
        words = tuple(normalized.split())
        targets = {normalized, *words}
        return _Term(
            normalized,
            words,
            tuple(_Word(target, frozenset(target)) for target in targets),
            text,
            category_id,
            dictionary_id,
        )

    def search(self, query: str, limit: int, fuzzy: bool = True) -> list[SearchMatch]:
        """The best match per category, highest score first."""
        normalized_query = normalize(query)
        if not normalized_query:
            return []

        best = self._best_per_category(lambda term: _direct_score(normalized_query, term))
        if fuzzy and not best:
            letters = frozenset(normalized_query)
            best = self._best_per_category(lambda term: _fuzzy_score(normalized_query, letters, term))
        return sorted(best.values(), key=lambda match: -match.score)[:limit]

    def _best_per_category(self, score_of: Callable[[_Term], float]) -> dict[str, SearchMatch]:
        best: dict[str, SearchMatch] = {}
        for term in self._terms:
            score = score_of(term)
            if score > 0 and (term.category_id not in best or score > best[term.category_id].score):
                best[term.category_id] = SearchMatch(
                    term.category_id, term.text, score, term.dictionary_id
                )
        return best

    def resolve(self, line: str) -> list[ResolvedPart]:
        """Split one free-text list line into items.

        Dictation has no separators ("milk bread eggs"), so a line that doesn't
        match as a whole is read longest phrase first. A word that matches
        nothing stays with its neighbour ("white bread"), so no text is lost.
        """
        words = line.split()
        if not words:
            return []

        whole = self._confident_match(" ".join(words), len(words))
        if whole:
            return [ResolvedPart(" ".join(words), whole, whole.score < _CONFIDENT_SCORE)]

        parts: list[ResolvedPart] = []
        leading: list[str] = []
        index = 0
        while index < len(words):
            phrase = self._longest_phrase(words, index)
            if phrase:
                size, match = phrase
                text = " ".join([*leading, *words[index : index + size]])
                uncertain = bool(leading) or match.score < _CONFIDENT_SCORE
                parts.append(ResolvedPart(text, match, uncertain))
                leading = []
                index += size
                continue
            if parts:
                parts[-1].text = f"{parts[-1].text} {words[index]}"
                parts[-1].uncertain = True
            else:
                leading.append(words[index])
            index += 1

        # "milk bread" is two items and "lemon juice" is one. Only meaning tells them apart.
        if len(parts) > 1:
            for part in parts:
                part.uncertain = True
        return parts or [ResolvedPart(" ".join(words), None, True)]

    def _longest_phrase(self, words: list[str], start: int) -> tuple[int, SearchMatch] | None:
        for size in range(min(_MAX_PHRASE_WORDS, len(words) - start), 0, -1):
            match = self._confident_match(" ".join(words[start : start + size]), size)
            if match:
                return size, match

        # Hebrew writes "and" as a prefix: "חלב ולחם" is milk and bread.
        word = words[start]
        if word.startswith(_AND_PREFIX) and len(word) > _MIN_SUBSTRING_LENGTH:
            match = self._confident_match(word[len(_AND_PREFIX) :], 1)
            if match:
                return 1, match
        return None

    def _confident_match(self, text: str, word_count: int) -> SearchMatch | None:
        length = len(normalize(text))
        fuzzy = word_count == 1 and length >= _MIN_FUZZY_LENGTH
        matches = self.search(text, limit=1, fuzzy=fuzzy)
        if not matches:
            return None
        if length < _MIN_SUBSTRING_LENGTH:
            required = 1.0
        elif fuzzy:
            required = _MIN_WORD_SCORE
        elif word_count == 1:
            # Three or four letters begin far too many unrelated words, so a short
            # item needs a name, a whole word of one, or a name's start: otherwise
            # "נרות יום הולדת" lands on "תחבושות יומיות".
            required = _CONFIDENT_SCORE
        else:
            required = _MIN_PHRASE_SCORE
        return matches[0] if matches[0].score >= required else None
