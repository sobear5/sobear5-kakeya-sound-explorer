// Checks the geometry and the synthesiser that index.html ships. No dependencies:
//     node kakeya-sound-explorer/tests/core.test.mjs
// The scripts are read straight out of index.html, so this tests exactly what the page runs.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');
const script = id => {
  const m = html.match(new RegExp(`<script id="${id}"[^>]*>([\\s\\S]*?)</script>`));
  assert.ok(m, `script #${id} not found`);
  return m[1];
};
const K = new Function(script('kakeya-core') + '\nreturn KakeyaCore;')();
const Synth = new Function(script('synth-src') + '\nreturn KakeyaSynthCore;')();

let seed = 1;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const lerp = (A, B, s) => [A[0] + s * (B[0] - A[0]), A[1] + s * (B[1] - A[1])];

// The paper's bisection and expansion (pp. 701-703), done literally on triangle vertices.
function literalTree(p) {
  let tris = [{ L: [-2 / p, 0], M: [2 / p, 0], N: [0, 2 / p] }];
  for (let k = 2; k < p; k++) {
    const s = (k + 1) / k, next = [];
    for (const t of tris) {
      const P = [(t.L[0] + t.M[0]) / 2, 0];
      next.push({ L: t.L, M: lerp(t.L, P, s), N: lerp(t.L, t.N, s) });  // LPN expanded from L
      next.push({ L: lerp(t.M, P, s), M: t.M, N: lerp(t.M, t.N, s) });  // MPN expanded from M
    }
    tris = next;
  }
  return tris;
}

test('closed form matches the literal bisection-and-expansion construction', () => {
  for (let p = 2; p <= 12; p++) {
    const lit = literalTree(p), st = K.treeStage(p);
    assert.equal(lit.length, 2 ** st.D);
    lit.forEach((t, idx) => {
      const c = K.treeTriangle(st, idx);
      for (const [a, b] of [[c.x0, t.L[0]], [c.x1, t.M[0]], [c.apex, t.N[0]], [c.top, t.N[1]]]) {
        assert.ok(Math.abs(a / p - b) < 1e-12, `p=${p} triangle ${idx}`);
      }
    });
  }
});

test('every triangle keeps the directions of its slot in the original fan', () => {
  for (const G of [5, 7.3, 10]) {
    const st = K.treeStage(G), N = 2 ** st.D;
    for (let idx = 0; idx < N; idx++) {
      for (const f of [0, 0.37, 1]) {
        const t = K.treeTriangle(st, idx), bx = t.x0 + f * (t.x1 - t.x0);
        assert.ok(Math.abs((bx - t.apex) / st.G - (2 * (idx + f) / N - 1)) < 1e-12);
      }
    }
  }
});

test('pruned tree walk agrees with checking every triangle', () => {
  for (const G of [2, 3, 4.5, 8, 11]) {
    const st = K.treeStage(G), count = K.treeCounter(st), N = 2 ** st.D;
    for (let i = 0; i < 2000; i++) {
      const u = rand() * G, X = (rand() * 2 - 1) * G;
      let brute = 0;
      for (let idx = 0; idx < N; idx++) {
        const t = K.treeTriangle(st, idx), L = t.x0 + t.slope * u;
        if (X >= L && X <= L + K.treeLen(st, u)) brute++;
      }
      assert.equal(K.treeQuery(st, X, u, 0), brute);
      assert.equal(count(X, u), brute);
    }
  }
});

test('Σp has area exactly 2/p: each slice between levels 1 and p-1 has length 2/p', () => {
  for (let p = 3; p <= 14; p++) {
    const st = K.treeStage(p), N = 2 ** st.D, A = new Float64Array(N), B = new Float64Array(N);
    for (let i = 0; i < 200; i++) {
      const u = 1 + rand() * (p - 2), v = rand();
      assert.ok(Math.abs(K.treeSlice(st, u, A, B) - 2) < 1e-9, `p=${p} u=${u}`);
      assert.ok(Math.abs(K.treeSlice(st, v, A, B) - (4 - 2 * v)) < 1e-9);
      assert.ok(Math.abs(K.treeSlice(st, p - v, A, B) - 2 * v) < 1e-9);
    }
    const job = K.model(K.TREE, p, p).areaJob();
    while (!job.step());
    assert.ok(Math.abs(job.value() - 2 / p) < 1e-9, `area p=${p}: ${job.value()}`);
  }
});

test('growth is continuous across whole stages', () => {
  const A = new Float64Array(4096), B = new Float64Array(4096);
  for (let k = 3; k <= 10; k++) {
    for (const u of [0, 0.3, 1.7, k - 0.4]) {
      const a = K.treeSlice(K.treeStage(k), u, A, B), b = K.treeSlice(K.treeStage(k + 1e-7), u, A, B);
      assert.ok(Math.abs(a - b) < 1e-5);
    }
  }
});

test("Kahane's set: walk agrees with brute force and the directions leave no gaps", () => {
  for (const G of [0, 1, 2.5, 4]) {
    const ks = K.kahaneStage(G), count = K.kahaneCounter(ks);
    let lefts = [0];
    for (let lev = 0; lev < ks.D; lev++) lefts = lefts.flatMap(v => [v, v + ks.step[lev]]);
    for (let i = 0; i < 1500; i++) {
      const t = rand(), x = rand() * 1.2 - 0.1, span = ks.ell[ks.D] * (1 - t / 2);
      let brute = 0;
      for (const c0 of lefts) for (const d0 of lefts) {
        const L = (1 - t) * c0 + (t / 2) * d0;
        if (x >= L && x <= L + span) brute++;
      }
      assert.equal(K.kahaneQuery(ks, x, t, 0), brute);
      assert.equal(count(x, t, false), brute);
    }
  }
  // Runs d/2 - c over all trapezoids at depth 6 cover [-1, 1/2] with no gaps.
  const ks = K.kahaneStage(6), e = ks.ell[6];
  let lefts = [0];
  for (let lev = 0; lev < 6; lev++) lefts = lefts.flatMap(v => [v, v + ks.step[lev]]);
  const runs = [];
  for (const c0 of lefts) for (const d0 of lefts) runs.push(d0 / 2 - c0);
  runs.sort((a, b) => a - b);
  for (let i = 1; i < runs.length; i++) assert.ok(runs[i] - runs[i - 1] <= 1.5 * e + 1e-12);
  assert.ok(runs[0] - e <= -1 + 1e-12 && runs[runs.length - 1] + e / 2 >= 0.5 - 1e-12);
});

test('needles reported through a point pass through it and are at least 1 long', () => {
  for (const [type, depth] of [[K.TREE, 9], [K.SQUARE, 7], [K.KAHANE, 4], [K.TRIANGLE, 8]]) {
    const m = K.model(type, depth, depth);
    for (let i = 0; i < 1000; i++) {
      const x = rand() * 2.2 - 1.1, y = rand() * (type === K.SQUARE ? 2 : 1);
      const nd = m.needles(x, y);
      assert.equal(nd.length, m.count(x, y));
      for (const n of nd) {
        const vx = n.ax - n.bx, vy = n.ay - n.by, len = Math.hypot(vx, vy);
        assert.ok(len >= 1 - 1e-9);
        assert.ok(Math.abs((x - n.bx) * vy - (y - n.by) * vx) / len < 1e-9);
        assert.ok(n.u >= -1e-9 && n.u <= 1 + 1e-9);
      }
    }
  }
});

// Distance travelled by the needle's two ends between two positions.
const moved = (a, b) => Math.max(Math.hypot(a.tail[0] - b.tail[0], a.tail[1] - b.tail[1]),
                                 Math.hypot(a.head[0] - b.head[0], a.head[1] - b.head[1]));

test('Perron-tree needle set: the needle turns 360° continuously, inside a triangle whenever it pivots', () => {
  for (const [p, reach] of [[3, 0.5], [5, 1.2], [6, 3], [8, 1.2]]) {
    const path = K.needlePath(K.NEEDLE, p, p, reach), st = K.treeStage(p), N = 2 ** st.D;
    assert.equal(path.triangles.length, 4 * N);
    // every join's turn at L fits inside the next triangle's fan, and its far point is at least `reach` out
    for (const j of path.joins) {
      const next = path.triangles[j.to], width = next.a1 - next.a0;
      assert.ok(j.a1 - j.a0 > 0 && j.a1 - j.a0 < width, `p=${p} join ${j.from}`);
      assert.ok(j.reach >= reach - 1e-12);
    }
    // continuity: with a fine enough sampling of every phase, consecutive positions are close
    for (const ph of path.phases) {
      let prev = path.at(ph.t0 + 1e-12);
      for (let i = 1; i <= 200; i++) {
        const cur = path.at(ph.t0 + (ph.t1 - ph.t0) * i / 200 - 1e-12);
        const span = ph.kind === 'slide' ? Math.hypot(ph.p1[0] - ph.p0[0], ph.p1[1] - ph.p0[1]) : Math.abs(ph.a1 - ph.a0);
        assert.ok(moved(prev, cur) <= span / 200 * 1.01 + 1e-9, `p=${p} jump in ${ph.kind}`);
        prev = cur;
      }
    }
    // the turn covers exactly one revolution and the loop closes
    const a = path.at(0), b = path.at(1 - 1e-13);
    assert.ok(moved(a, b) < 1e-6, `p=${p} loop closes`);
    assert.ok(Math.abs(b.turn - 1) < 1e-6);
    // while pivoting at an apex, the needle lies in that triangle of its tree
    for (const ph of path.phases.filter(q => q.tri !== undefined)) {
      const T = path.triangles[ph.tri];
      for (let i = 0; i <= 20; i++) {
        const pos = path.at(ph.t0 + (ph.t1 - ph.t0) * i / 20);
        for (let f = 0; f <= 1; f += 0.25) {
          const x = pos.tail[0] + f * (pos.head[0] - pos.tail[0]), y = pos.tail[1] + f * (pos.head[1] - pos.tail[1]);
          const l = K.quarterTurns(x, y, -T.side), tri = K.treeTriangle(st, T.index);
          const u = l[1] * p, L = tri.x0 + tri.slope * u;
          assert.ok(u >= -1e-9 && u <= p + 1e-9 && l[0] * p >= L - 1e-7 && l[0] * p <= L + K.treeLen(st, u) + 1e-7,
            `p=${p} triangle ${ph.tri} needle point outside`);
        }
      }
    }
    assert.ok(path.joinArea > 0);
  }
  // pushing the joins further out shrinks the area they add
  const near = K.needlePath(K.NEEDLE, 5, 5, 1).joinArea, far = K.needlePath(K.NEEDLE, 5, 5, 40).joinArea;
  assert.ok(far < near / 5, `${near} -> ${far}`);
});

test('equilateral triangle and disc: the needle stays inside and turns once', () => {
  for (const type of [K.EQUI, K.DISK]) {
    const path = K.needlePath(type, 1, 1, 1), m = K.model(type, 1, 1);
    let prev = path.at(0);
    for (let i = 1; i <= 4000; i++) {
      const s = i / 4000, pos = path.at(s % 1);
      for (let f = 0; f <= 1; f += 0.125) {
        const x = pos.tail[0] + f * (pos.head[0] - pos.tail[0]), y = pos.tail[1] + f * (pos.head[1] - pos.tail[1]);
        const nx = x * (1 - 1e-9), ny = type === K.EQUI ? (y - 1 / 3) * (1 - 1e-9) + 1 / 3 : y * (1 - 1e-9);
        assert.ok(m.contains(nx, ny), `type ${type} s=${s}`);
      }
      assert.ok(moved(prev, pos) < 0.01);
      assert.ok(Math.abs(Math.hypot(pos.head[0] - pos.tail[0], pos.head[1] - pos.tail[1]) - 1) < 1e-9);
      prev = pos;
    }
    assert.ok(Math.abs(path.at(1 - 1e-9).turn - 1) < 1e-6);
  }
});

test('deltoid: tangent chords have length 1, and three of them pass through every inside point', () => {
  const a = 0.25;
  for (let i = 0; i < 400; i++) {
    const t = 4 * Math.PI * i / 400, [P, Q] = K.deltoidChord(t);
    assert.ok(Math.abs(Math.hypot(Q[0] - P[0], Q[1] - P[1]) - 1) < 1e-12, `t=${t}`);
    assert.ok(Math.abs(K.deltoidF(...P)) < 1e-12 && Math.abs(K.deltoidF(...Q)) < 1e-12);
    const u = [-Math.cos(t / 2), Math.sin(t / 2)];   // the chord lies along the tangent at t
    assert.ok(Math.abs((Q[0] - P[0]) * u[1] - (Q[1] - P[1]) * u[0]) < 1e-12 && (Q[0] - P[0]) * u[0] + (Q[1] - P[1]) * u[1] > 0);
  }
  const m = K.model(K.DELTOID, 1, 1);
  let checked = 0;
  for (let i = 0; i < 3000 && checked < 300; i++) {
    const x = (rand() * 2 - 1) * 3 * a, y = (rand() * 2 - 1) * 3 * a;
    if (K.deltoidF(x, y) > -1e-4) continue;   // stay clear of the boundary
    checked++;
    const nd = m.needles(x, y);
    assert.equal(nd.length, 3, `(${x}, ${y})`);
    for (const n of nd) {
      const vx = n.ax - n.bx, vy = n.ay - n.by;
      assert.ok(Math.abs((x - n.bx) * vy - (y - n.by) * vx) < 1e-7);
      const f = ((x - n.bx) * vx + (y - n.by) * vy) / (vx * vx + vy * vy);
      assert.ok(f > -1e-9 && f < 1 + 1e-9);
    }
  }
  assert.ok(checked >= 200);
  // area π/8: Monte Carlo over the bounding box agrees
  let hits = 0;
  for (let i = 0; i < 200000; i++) if (m.contains((rand() * 2 - 1) * 0.75, (rand() * 2 - 1) * 0.75)) hits++;
  assert.ok(Math.abs(hits / 200000 * 2.25 - Math.PI / 8) < 0.005);
});

test('equilateral triangle: the needles through a point are the corners within reach', () => {
  const m = K.model(K.EQUI, 1, 1);
  for (let i = 0; i < 2000; i++) {
    const x = rand() * 1.2 - 0.6, y = rand();
    const nd = m.needles(x, y);
    assert.equal(nd.length, m.count(x, y));
    if (m.contains(x, y)) assert.ok(nd.length >= 1);
  }
});

// Fundamental frequency from the autocorrelation of one channel.
function pitch(x, sr) {
  let best = 0, bestLag = 0;
  for (let lag = Math.floor(sr / 2000); lag < sr / 15; lag++) {
    let s = 0;
    for (let i = 0; i + lag < x.length; i++) s += x[i] * x[i + lag];
    if (s > best * 1.0001) { best = s; bestLag = lag; }
  }
  return sr / bestLag;
}

function render(synth, seconds) {
  const n = Math.round(seconds * synth.sr), L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i += 128) {
    const k = Math.min(128, n - i);
    synth.process(L.subarray(i, i + k), R.subarray(i, i + k), k);
  }
  return [L, R];
}

test('orbit voice: m needles give a 2m-step cycle, like a period-2m orbit in FSE', () => {
  const sr = 48000, stepRate = 1760, steps = Math.round(sr / stepRate);
  for (const m of [1, 3, 8]) {
    const pts = [];
    for (let i = 0; i < 2 * m; i++) {
      const a = 1.1 + i * Math.PI / m + 0.05 * Math.sin(5 * i);
      pts.push(Math.cos(a), Math.sin(a));
    }
    const s = new Synth(sr);
    s.handle({ cmd: 'orbit', pts: Float32Array.from(pts), stepRate, reset: true });
    const [L, R] = render(s, 0.6);
    const tail = R.subarray(sr * 0.2);
    const f = pitch(tail, sr), want = sr / steps / (2 * m);
    assert.ok(Math.abs(f / want - 1) < 0.02, `m=${m}: ${f} Hz, expected ${want}`);
    for (const v of L) assert.ok(Number.isFinite(v) && Math.abs(v) <= 1);
  }
});

test('a held point that leaves the set and comes back resumes; an explicit stop does not', () => {
  const s = new Synth(48000), two = Float32Array.from([1, 0, -1, 0]);
  s.handle({ cmd: 'orbit', pts: two, stepRate: 1760, reset: true });
  s.handle({ cmd: 'orbit', pts: new Float32Array(0), stepRate: 1760, reset: false });
  assert.equal(s.volume, 0);
  s.handle({ cmd: 'orbit', pts: two, stepRate: 1760, reset: false });
  assert.equal(s.volume, 1);
  s.handle({ cmd: 'stop' });
  s.handle({ cmd: 'orbit', pts: two, stepRate: 1760, reset: false });
  assert.equal(s.volume, 0);
});

test("dampening matches FSE's 0.9992 per 1/4000 s", () => {
  const sr = 48000, s = new Synth(sr);
  s.handle({ cmd: 'config', damp: true });
  s.handle({ cmd: 'orbit', pts: Float32Array.from([1, 0, -1, 0]), stepRate: 1760, reset: true });
  render(s, 1);
  assert.ok(Math.abs(s.volume - Math.pow(0.9992, 4000)) < 1e-3);
});

test('chord voice plays one partial per needle and goes quiet when stopped', () => {
  const sr = 48000, s = new Synth(sr);
  s.handle({ cmd: 'chord', reset: true, voices: [
    { key: 1, freq: 220, pan: -1 }, { key: 2, freq: 330, pan: 0 }, { key: 3, freq: 440, pan: 1 }] });
  let [L, R] = render(s, 0.3);
  assert.equal(s.voices.length, 3);
  const rms = x => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length);
  assert.ok(rms(L) > 0.02 && rms(R) > 0.02);
  s.handle({ cmd: 'stop' });
  [L, R] = render(s, 0.2);
  assert.ok(rms(L.subarray(sr * 0.1)) < 1e-4);
});
