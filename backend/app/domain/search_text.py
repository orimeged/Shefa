"""Text folding shared by search and the dictionary."""

import re
import unicodedata

_FINAL_LETTERS = str.maketrans("ךםןףץ", "כמנפצ")
_PUNCTUATION = re.compile(r"[^\w\s]")


def normalize(text: str) -> str:
    """Fold case, niqqud, punctuation and Hebrew final letters."""
    without_marks = "".join(
        char for char in unicodedata.normalize("NFKD", text) if not unicodedata.combining(char)
    )
    folded = _PUNCTUATION.sub(" ", without_marks.casefold()).translate(_FINAL_LETTERS)
    return " ".join(folded.split())
