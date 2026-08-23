#!/usr/bin/env python3
"""Regenerate `crates/pk-core/src/jsmath/pow_data.rs` from ARM's C.

Hand-transcribing 128 four-double rows and 256 u64s is exactly the kind of job
that produces a table that is right in 383 places. So: parse the C, evaluate
the arithmetic in IEEE double (Python floats ARE doubles), and emit bit
patterns rather than decimal — the Rust side then has no parsing step at all.

Inputs (fetch into --src, default ./vendor-math, none of it is committed):

    curl -O https://raw.githubusercontent.com/ARM-software/optimized-routines/\\
             master/math/pow_log_data.c        # -> arm_pow_log_data.c
    curl -O .../math/exp_data.c                # -> arm_exp_data.c

Usage:
    python3 scripts/transcribe-pow-tables.py crates/pk-core/src/jsmath/pow_data.rs \\
        [--src DIR] [--emit-c PATH]

`--emit-c` writes the same tables as a C header for
`scripts/pow-contraction-probe.c`, which is what established that the runtime's
pow is the FMA-CONTRACTED build of this algorithm — see `jsmath::pow_arm`.
"""
import argparse, re, struct

ap = argparse.ArgumentParser()
ap.add_argument("out", help="path to write pow_data.rs")
ap.add_argument("--src", default="vendor-math", help="dir holding the fetched ARM .c files")
ap.add_argument("--emit-c", default=None, help="also write the tables as a C header")
args = ap.parse_args()
SCR = args.src

def bits(x: float) -> int:
    return struct.unpack("<Q", struct.pack("<d", x))[0]

HEXF = r"[-+]?0x[0-9a-fA-F]*\.?[0-9a-fA-F]*p[-+]?\d+"

def hexf(tok: str) -> float:
    return float.fromhex(tok.strip())

def strip_comments(s: str) -> str:
    s = re.sub(r"/\*.*?\*/", "", s, flags=re.S)
    s = re.sub(r"//[^\n]*", "", s)
    return s

# ── pow_log_data ────────────────────────────────────────────────────────────
src = strip_comments(open(f"{SCR}/arm_pow_log_data.c").read())

ln2hi = hexf(re.search(r"\.ln2hi\s*=\s*(" + HEXF + r")", src).group(1))
ln2lo = hexf(re.search(r"\.ln2lo\s*=\s*(" + HEXF + r")", src).group(1))

# .poly — the N==128 && POW_LOG_POLY_ORDER==8 block. Entries carry scaling
# multipliers (`* -2`, `* 4`, `* -8`) that the C compiler folds; fold them here.
poly_block = re.search(r"\.poly\s*=\s*\{(.*?)\n\},", src, re.S).group(1)
poly_block = re.sub(r"#if[^\n]*\n", "", poly_block)
poly_block = re.sub(r"#endif[^\n]*\n?", "", poly_block)
log_poly = []
for line in poly_block.split(","):
    line = line.strip()
    if not line:
        continue
    m = re.match(r"^(" + HEXF + r")\s*(?:\*\s*(-?\d+))?$", line)
    assert m, f"unparsed log poly entry: {line!r}"
    v = hexf(m.group(1))
    if m.group(2):
        v = v * float(int(m.group(2)))
    log_poly.append(v)
assert len(log_poly) == 7, log_poly

# .tab — A(invc, logc, logctail) rows. The struct has a `pad` field between
# invc and logc which the A() macro fills with 0 and the algorithm never reads.
rows = re.findall(r"A\(\s*(" + HEXF + r")\s*,\s*(" + HEXF + r")\s*,\s*(" + HEXF + r")\s*\)", src)
log_tab = [(hexf(a), hexf(b), hexf(c)) for a, b, c in rows]
assert len(log_tab) == 128, f"pow_log tab has {len(log_tab)} rows, want 128"

# ── exp_data (N == 128 branches) ────────────────────────────────────────────
esrc = strip_comments(open(f"{SCR}/arm_exp_data.c").read())

invln2N = hexf(re.search(r"\.invln2N\s*=\s*(" + HEXF + r")\s*\*\s*N", esrc).group(1)) * 128.0
# `.shift` sits in an `#if EXP_USE_TOINT_NARROW / #else` pair and that macro is
# 0, so the SECOND value is the live one. Taking the first silently produced
# 0x1.8000000008000p+36 — the narrow-toint constant — which is a wrong answer
# that still looks like a plausible magic number.
shift_arm = re.search(r"#if EXP_USE_TOINT_NARROW(.*?)#endif", esrc, re.S).group(1)
shift_vals = re.findall(r"\.shift\s*=\s*(" + HEXF + r")", shift_arm)
assert len(shift_vals) == 2, shift_vals
assert "#else" in shift_arm
shift = hexf(shift_vals[1])
assert shift == float.fromhex("0x1.8p52"), shift.hex()

def pick_branch(text: str, start_pat: str, want: str) -> str:
    """Return the body of the #if/#elif arm whose condition == `want`."""
    body = re.search(start_pat, text, re.S).group(1)
    arms = re.split(r"#(?:el)?if\s+", body)
    for arm in arms:
        if not arm.strip():
            continue
        cond, _, rest = arm.partition("\n")
        if cond.strip() == want:
            return rest.split("#el")[0].split("#endif")[0]
    raise SystemExit(f"no arm matching {want!r}")

# negln2hiN / negln2loN live in a bare #if chain, not inside a braced field.
neg_arm = pick_branch(esrc, r"(\.negln2hiN.*?#endif)", "N == 128")
negln2hiN = hexf(re.search(r"\.negln2hiN\s*=\s*(" + HEXF + r")", neg_arm).group(1))
negln2loN = hexf(re.search(r"\.negln2loN\s*=\s*(" + HEXF + r")", neg_arm).group(1))

poly_arm = pick_branch(esrc, r"\.poly\s*=\s*\{(.*?)\n\},", "N == 128 && EXP_POLY_ORDER == 5 && !EXP_POLY_WIDE")
exp_poly = [hexf(t) for t in re.findall(HEXF, poly_arm)]
assert len(exp_poly) == 4, exp_poly

tab_arm = pick_branch(esrc, r"\.tab\s*=\s*\{(.*?)\n\},", "N == 128")
exp_tab = [int(t, 16) for t in re.findall(r"0x[0-9a-fA-F]+", tab_arm)]
assert len(exp_tab) == 256, f"exp tab has {len(exp_tab)} entries, want 256"

# ── emit ────────────────────────────────────────────────────────────────────
out = []
w = out.append
w("// @generated by scratchpad/transcribe_pow.py from ARM optimized-routines")
w("// math/pow_log_data.c and math/exp_data.c. Do not hand-edit: regenerate.")
w("//")
w("// Values are bit patterns, not decimal literals — the tables were parsed as")
w("// hex floats and printed as bits, so no decimal round-trip sits between the")
w("// C source and the Rust constant.")
w("")
w(f"pub const LN2HI: f64 = f64::from_bits(0x{bits(ln2hi):016x}); // {ln2hi.hex()}")
w(f"pub const LN2LO: f64 = f64::from_bits(0x{bits(ln2lo):016x}); // {ln2lo.hex()}")
w("")
w("/// `A` in the C: log1p polynomial, pre-scaled. `A[0]` is exactly -0.5.")
w("pub const LOG_POLY: [f64; 7] = [")
for v in log_poly:
    w(f"    f64::from_bits(0x{bits(v):016x}), // {v.hex()}")
w("];")
w("")
w("/// `T` in the C: (invc, logc, logctail) per subinterval. The C struct's")
w("/// `pad` field is dropped — the algorithm never reads it.")
w("pub const LOG_TAB: [(f64, f64, f64); 128] = [")
for a, b, c in log_tab:
    w(f"    (f64::from_bits(0x{bits(a):016x}), f64::from_bits(0x{bits(b):016x}), f64::from_bits(0x{bits(c):016x})),")
w("];")
w("")
w(f"pub const INV_LN2N: f64 = f64::from_bits(0x{bits(invln2N):016x});")
w(f"pub const NEG_LN2HI_N: f64 = f64::from_bits(0x{bits(negln2hiN):016x});")
w(f"pub const NEG_LN2LO_N: f64 = f64::from_bits(0x{bits(negln2loN):016x});")
w(f"pub const SHIFT: f64 = f64::from_bits(0x{bits(shift):016x});")
w("")
w("/// `__exp_data.poly` for N=128, order 5: C2, C3, C4, C5.")
w("pub const EXP_POLY: [f64; 4] = [")
for v in exp_poly:
    w(f"    f64::from_bits(0x{bits(v):016x}), // {v.hex()}")
w("];")
w("")
w("/// `__exp_data.tab`: interleaved (tail bits, scale bits) per 1/128 step.")
w("pub const EXP_TAB: [u64; 256] = [")
for i in range(0, 256, 2):
    w(f"    0x{exp_tab[i]:016x}, 0x{exp_tab[i+1]:016x},")
w("];")
w("")

open(args.out, "w").write("\n".join(out))
print(f"wrote {args.out}: {len(log_tab)} log rows, {len(exp_tab)} exp entries")
print(f"  ln2hi={ln2hi.hex()} ln2lo={ln2lo.hex()} shift={shift.hex()} invln2N={invln2N.hex()}")

# ── the same tables as C, for the FMA-contraction experiment ────────────────
#
# The strict Rust transcription lands 1 ulp from glibc on 153 of 200,001 inputs
# and both HAVE_FAST_FMA arms agree, so the difference is outside the source.
# Emitting the identical tables as C lets the same algorithm be compiled with
# and without GCC's `a*b + c` contraction and compared against glibc directly —
# which is how the contraction was identified rather than guessed.
if not args.emit_c:
    raise SystemExit(0)
c = []
c.append("// @generated by transcribe-pow-tables.py — tables for the contraction probe.")
c.append("#include <stdint.h>")
c.append(f"static const double Ln2hi = {ln2hi.hex()};")
c.append(f"static const double Ln2lo = {ln2lo.hex()};")
c.append("static const double A[7] = {" + ", ".join(v.hex() for v in log_poly) + "};")
c.append("struct logrow { double invc, logc, logctail; };")
c.append("static const struct logrow T[128] = {")
for a, b, cc in log_tab:
    c.append(f"  {{{a.hex()}, {b.hex()}, {cc.hex()}}},")
c.append("};")
c.append(f"static const double InvLn2N = {invln2N.hex()};")
c.append(f"static const double NegLn2hiN = {negln2hiN.hex()};")
c.append(f"static const double NegLn2loN = {negln2loN.hex()};")
c.append(f"static const double Shift = {shift.hex()};")
c.append("static const double C[4] = {" + ", ".join(v.hex() for v in exp_poly) + "};")
c.append("static const uint64_t ET[256] = {")
for i in range(0, 256, 2):
    c.append(f"  0x{exp_tab[i]:016x}ULL, 0x{exp_tab[i+1]:016x}ULL,")
c.append("};")
open(args.emit_c, "w").write("\n".join(c) + "\n")
print(f"  also wrote {args.emit_c}")
