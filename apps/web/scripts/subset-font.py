"""Rebuild public/fonts/InterVariable-latin.woff2 from font-src/InterVariable.woff2.

Pins opsz at 14 (text), keeps wght 100-900, Latin + Latin-1 + punctuation, arrows, box glyphs,
and the tnum/ss01/cv11 features. Needs: pip install fonttools brotli.  Licence: public/fonts/OFL.txt.
"""
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

root = Path(__file__).resolve().parent.parent
font = instancer.instantiateVariableFont(TTFont(root / "font-src/InterVariable.woff2"), {"opsz": 14})
uni = (
    list(range(0x20, 0x7F)) + list(range(0xA0, 0x100))
    + [0x2009, 0x202F, 0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2026, 0x2032, 0x2033, 0x2044, 0x20AC, 0x2122, 0x2212, 0x00D7]
    + [0x2190, 0x2191, 0x2192, 0x2193, 0x2194, 0x21B5, 0x2318, 0x2325, 0x21E7, 0x2303, 0x238B, 0x23CE, 0x2713, 0x2715, 0x25CF, 0x25B6, 0x25A0]
    + [0x2500, 0x2502, 0x250C, 0x2510, 0x2514, 0x2518, 0x251C, 0x2524, 0x252C, 0x2534, 0x253C, 0x2588, 0x2591, 0x2592, 0x2593]
)
opts = subset.Options()
opts.flavor = "woff2"
opts.layout_features = ["kern", "calt", "ccmp", "locl", "mark", "mkmk", "case", "liga", "pnum", "tnum", "zero", "ss01", "cv11"]
opts.notdef_outline = True
opts.hinting = False
opts.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
s = subset.Subsetter(opts)
s.populate(unicodes=uni)
s.subset(font)
font.flavor = "woff2"
font.save(root / "public/fonts/InterVariable-latin.woff2")
