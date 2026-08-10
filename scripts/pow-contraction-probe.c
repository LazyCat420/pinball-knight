// Does GCC's FMA contraction explain the last 153 divergences? (It does.)
//
// ARM's pow.c, transcribed with the same tables `jsmath::pow_data` carries,
// compiled once as written and run against glibc's own pow over the oracle's
// sweeps. The point is the BUILD FLAGS, not the source:
//
//   python3 scripts/transcribe-pow-tables.py /dev/null \
//       --src vendor-math --emit-c /tmp/pow_tables.h
//   gcc -O2 -mfma                     -DUSE_FMA_ARM=1 -I/tmp this.c -o p -lm  # 0 differ
//   gcc -O2 -mfma -ffp-contract=off   -DUSE_FMA_ARM=1 -I/tmp this.c -o p -lm  # 153 differ
//   gcc -O2                           -DUSE_FMA_ARM=0 -I/tmp this.c -o p -lm  # 153 differ
//
// 153 is exactly what the strict Rust produced before the fusions were added,
// and under contraction the two HAVE_FAST_FMA arms converge — so the arm never
// mattered and the fusion set is the whole answer. Kept in the tree because the
// next target that disagrees will be diagnosed the same way.
//
// `-fdump-tree-optimized` on the contracting build lists the fusions
// individually; that dump is what `jsmath::pow_arm`'s mul_add calls mirror.
#include <stdio.h>
#include <stdint.h>
#include <math.h>
#include "pow_tables.h"

static inline double asdouble(uint64_t i) { double d; __builtin_memcpy(&d, &i, 8); return d; }
static inline uint64_t asuint64(double d) { uint64_t i; __builtin_memcpy(&i, &d, 8); return i; }
static inline uint32_t top12(double x) { return asuint64(x) >> 52; }

#define N 128
#define OFF 0x3fe6955500000000

static inline double log_inline(uint64_t ix, double *tail) {
  uint64_t tmp = ix - OFF;
  int i = (tmp >> (52 - 7)) % N;
  int k = (int64_t)tmp >> 52;
  uint64_t iz = ix - (tmp & 0xfffULL << 52);
  double z = asdouble(iz);
  double kd = (double)k;
  double invc = T[i].invc, logc = T[i].logc, logctail = T[i].logctail;

#if USE_FMA_ARM
  double r = fma(z, invc, -1.0);
#else
  double zhi = asdouble((iz + (1ULL << 31)) & (-1ULL << 32));
  double zlo = z - zhi;
  double rhi = zhi * invc - 1.0;
  double rlo = zlo * invc;
  double r = rhi + rlo;
#endif

  double t1 = kd * Ln2hi + logc;
  double t2 = t1 + r;
  double lo1 = kd * Ln2lo + logctail;
  double lo2 = t1 - t2 + r;

  double ar = A[0] * r, ar2 = r * ar, ar3 = r * ar2;
  double hi, lo3, lo4;
#if USE_FMA_ARM
  hi = t2 + ar2;
  lo3 = fma(ar, r, -ar2);
  lo4 = t2 - hi + ar2;
#else
  double arhi = A[0] * rhi;
  double arhi2 = rhi * arhi;
  hi = t2 + arhi2;
  lo3 = rlo * (ar + arhi);
  lo4 = t2 - hi + arhi2;
#endif
  double p = ar3 * (A[1] + r * A[2] + ar2 * (A[3] + r * A[4] + ar2 * (A[5] + r * A[6])));
  double lo = lo1 + lo2 + lo3 + lo4 + p;
  double y = hi + lo;
  *tail = hi - y + lo;
  return y;
}

static double specialcase(double tmp, uint64_t sbits, uint64_t ki) {
  double scale, y;
  if ((ki & 0x80000000) == 0) {
    sbits -= 1009ull << 52;
    scale = asdouble(sbits);
    y = scale + scale * tmp;
    return y * 0x1p1009;
  }
  sbits += 1022ull << 52;
  scale = asdouble(sbits);
  y = scale + scale * tmp;
  if (fabs(y) < 1.0) {
    double hi, lo, one = y < 0.0 ? -1.0 : 1.0;
    lo = scale - y + scale * tmp;
    hi = one + y;
    lo = one - hi + y + lo;
    y = (hi + lo) - one;
    if (y == 0.0) y = asdouble(sbits & 0x8000000000000000);
  }
  return 0x1p-1022 * y;
}

static inline double exp_inline(double x, double xtail, uint32_t sign_bias) {
  uint32_t abstop = top12(x) & 0x7ff;
  if (abstop - top12(0x1p-54) >= top12(512.0) - top12(0x1p-54)) {
    if (abstop - top12(0x1p-54) >= 0x80000000) {
      double one = 1.0 + x;
      return sign_bias ? -one : one;
    }
    if (abstop >= top12(1024.0)) {
      if (asuint64(x) >> 63) return sign_bias ? -0.0 : 0.0;
      return sign_bias ? -INFINITY : INFINITY;
    }
    abstop = 0;
  }
  double z = InvLn2N * x;
  double kd = z + Shift;
  uint64_t ki = asuint64(kd);
  kd -= Shift;
  double r = x + kd * NegLn2hiN + kd * NegLn2loN;
  r += xtail;
  uint64_t idx = 2 * (ki % N);
  uint64_t top = (ki + sign_bias) << (52 - 7);
  double tail = asdouble(ET[idx]);
  uint64_t sbits = ET[idx + 1] + top;
  double r2 = r * r;
  double tmp = tail + r + r2 * (C[0] + r * C[1]) + r2 * r2 * (C[2] + r * C[3]);
  if (abstop == 0) return specialcase(tmp, sbits, ki);
  double scale = asdouble(sbits);
  return scale + scale * tmp;
}

double mypow(double x, double y) {
  uint64_t ix = asuint64(x), iy = asuint64(y);
  // The sweep only feeds x in [0,1] and y in {1.35, 2.5, 7}, so the special
  // cases the real pow needs are deliberately not reproduced here — this file
  // exists to compare ARITHMETIC, not edge cases.
  if (x == 0.0) return 0.0;
  (void)iy;
  double lo, hi = log_inline(ix, &lo);
  double ehi, elo;
#if USE_FMA_ARM
  ehi = y * hi;
  elo = y * lo + fma(y, hi, -ehi);
#else
  double yhi = asdouble(iy & -1ULL << 27);
  double ylo = y - yhi;
  double lhi = asdouble(asuint64(hi) & -1ULL << 27);
  double llo = hi - lhi + lo;
  ehi = yhi * lhi;
  elo = ylo * lhi + y * llo;
#endif
  return exp_inline(ehi, elo, 0);
}

int main(void) {
  struct { double e; unsigned n; } sweeps[] = {{1.35, 200000}, {2.5, 100000}, {7.0, 50000}};
  for (unsigned s = 0; s < 3; s++) {
    unsigned diff = 0;
    for (unsigned k = 0; k <= sweeps[s].n; k++) {
      double x = (double)k / (double)sweeps[s].n;
      if (asuint64(mypow(x, sweeps[s].e)) != asuint64(pow(x, sweeps[s].e))) diff++;
    }
    printf("x^%g: %u/%u differ from glibc pow\n", sweeps[s].e, diff, sweeps[s].n + 1);
  }
  return 0;
}
