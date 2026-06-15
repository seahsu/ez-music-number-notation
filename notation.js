// ── Jianpu notation core ────────────────────────────────────────────────────
// Single source of truth for parsing + beat math. Loaded by editor.html as a
// plain <script>, and imported by notation.test.mjs under node --test.
//
// Token model — fields on a parsed note:
//   ul    underline levels (减时线): eighth=1, sixteenth=2 …
//   ou    octave dots above ('): high register
//   od    octave dots below (,): low register
//   bold  rhythm/note emphasis (*)
//   acc   accidental "" | "#" | "b"
//   num   scale degree 0–7 (0 = rest), or -1 for non-note tokens
//   chord chord name (e.g. "Bb", "Gm7") when type === "chord"
//   dt    augmentation dots (.): count
//   ds    duration dashes (-): count, each = +1 beat
//   type  "note" | "rhythm" | "chord"
;(function (root, factory) {
	const api = factory()
	if (typeof module !== "undefined" && module.exports) module.exports = api
	else Object.assign(root, api)
})(typeof self !== "undefined" ? self : globalThis, function () {
	function parseNote(str) {
		let i = 0
		const n = { ul: 0, ou: 0, od: 0, bold: false, acc: "", num: -1, chord: "", dt: 0, ds: 0, type: "note" }

		while (str[i] === "_") {
			n.ul++
			i++
		}
		while (str[i] === "'") {
			n.ou++
			i++
		}
		while (str[i] === ",") {
			n.od++
			i++
		}
		if (str[i] === "*") {
			n.bold = true
			i++
		}

		// Rhythm hit: x (case-insensitive)
		if (str[i] === "x" || str[i] === "X") {
			n.type = "rhythm"
			i++
		}
		// Chord: starts with uppercase A–G
		else if (/[A-G]/.test(str[i])) {
			n.type = "chord"
			let cn = ""
			while (i < str.length && str[i] !== "." && str[i] !== "-") {
				cn += str[i]
				i++
			}
			n.chord = cn
		}
		// Flat chord: bX notation (e.g. bB → Bb, bE → Eb)
		else if (str[i] === "b" && /[A-G]/.test(str[i + 1])) {
			n.type = "chord"
			let cn = str[i + 1] + "b"
			i += 2 // normalize bB → Bb
			while (i < str.length && str[i] !== "." && str[i] !== "-") {
				cn += str[i]
				i++
			}
			n.chord = cn
		}
		// Regular note
		else {
			if (str[i] === "#" || str[i] === "b") {
				n.acc = str[i]
				i++
			}
			if (str[i] >= "0" && str[i] <= "7") {
				n.num = +str[i]
				i++
			}
		}

		while (str[i] === ".") {
			n.dt++
			i++
		}
		while (str[i] === "-") {
			n.ds++
			i++
		}

		if (n.type === "note" && n.num < 0) return null
		return n
	}

	function expandTok(tok) {
		// Expand a single whitespace-delimited token into one or more groups.
		// Multi-digit shorthand: __12 → [{ul:2,num:1}, {ul:2,num:2}] as separate groups.
		// Single-digit / rhythm / chord: returns one group (identical to parseNote).
		let i = 0
		let ul = 0,
			ou = 0,
			od = 0,
			bold = false
		while (tok[i] === "_") {
			ul++
			i++
		}
		while (tok[i] === "'") {
			ou++
			i++
		}
		while (tok[i] === ",") {
			od++
			i++
		}
		if (tok[i] === "*") {
			bold = true
			i++
		}

		// Rhythm hit or chord name — fall back to original single-note parse
		if (i < tok.length && (tok[i] === "x" || tok[i] === "X" || /[A-G]/.test(tok[i]))) return [[parseNote(tok)].filter(Boolean)].filter((g) => g.length)

		// Regular note(s): optional accidental then one or more digits.
		// Per-digit octave markers (' , ) and accidentals between digits are supported:
		//   __'1234  → all 4 notes high-octave (shared prefix sticks as default)
		//   __'4'3   → both high-octave (explicit per-digit matches the sticky default)
		//   __'4,3   → first high, second low (per-digit overrides the sticky default)
		let acc = ""
		if (tok[i] === "#" || tok[i] === "b") {
			acc = tok[i]
			i++
		}

		// Sticky defaults from the token prefix — carried forward unless overridden per-digit.
		let nextOu = ou, nextOd = od

		const notes = []
		while (i < tok.length && tok[i] >= "0" && tok[i] <= "7") {
			const curOu = nextOu, curOd = nextOd, curAcc = acc
			const num = +tok[i++]
			let dt = 0, ds = 0
			while (tok[i] === ".") { dt++; i++ }
			while (tok[i] === "-") { ds++; i++ }
			notes.push({ ul, ou: curOu, od: curOd, bold, acc: curAcc, num, chord: "", dt, ds, type: "note" })

			// Consume per-digit octave / accidental markers for the next digit.
			// If none present, restore the sticky prefix values (e.g. __'1234 keeps ou=1 for all).
			acc = ""
			if (tok[i] === "'" || tok[i] === "," || tok[i] === "#" || tok[i] === "b") {
				nextOu = 0; nextOd = 0
				while (tok[i] === "'") { nextOu++; i++ }
				while (tok[i] === ",") { nextOd++; i++ }
				if (tok[i] === "#" || tok[i] === "b") { acc = tok[i]; i++ }
			} else {
				nextOu = ou; nextOd = od // no override → sticky prefix continues
			}
		}

		if (!notes.length) return [[parseNote(tok)].filter(Boolean)].filter((g) => g.length)
		return notes.map((n) => [n]) // each digit becomes its own group → beamed by measureH
	}

	function parseMeasure(text) {
		let s = text.trim()

		// Leading '+' = cross-measure tie-in (continued from previous measure)
		const tieIn = s.startsWith("+")
		if (tieIn) s = s.slice(1).trimStart()

		// Trailing '+' on the last whitespace token = cross-measure tie-out
		const rawToks = s.split(/\s+/).filter(Boolean)
		let tieOut = false
		if (rawToks.length > 0 && rawToks[rawToks.length - 1].endsWith("+")) {
			tieOut = true
			rawToks[rawToks.length - 1] = rawToks[rawToks.length - 1].slice(0, -1)
		}

		const groups = rawToks
			.flatMap((tok) => {
				// Tied group (e.g. _1+_2): keep as one group, original behaviour
				if (tok.includes("+")) return [tok.split("+").map(parseNote).filter(Boolean)].filter((g) => g.length)
				// Multi-digit shorthand (e.g. __12 → two separate groups, beamed automatically)
				return expandTok(tok)
			})
			.filter((g) => g.length)

		// Tag first / last group for cross-measure tie tracking in playback
		if (tieIn && groups.length > 0) groups[0]._tieIn = true
		if (tieOut && groups.length > 0) groups[groups.length - 1]._tieOut = true

		return groups
	}

	// ── Beat math ───────────────────────────────────────────────────────────
	// Two distinct measures of "beats" — keep them separate:
	//
	// displayBeats(): LAYOUT WIDTH ONLY. A dot adds a fixed +0.5 (not ×1.5) so a
	// dotted eighth renders 0.5+0.5 = 1 slot wide. Used for flex proportions in
	// measureH(); it is NOT musical time and must never be used to validate meter.
	function displayBeats(n) {
		let beats = 1 / Math.pow(2, n.ul)
		if (n.dt >= 1) beats += 0.5
		beats += n.ds
		return beats
	}
	function groupBeats(g) {
		return g.reduce((s, n) => s + displayBeats(n), 0)
	}

	// noteDuration(): TRUE musical duration in quarter-note beats. A dot multiplies
	// by 1.5 per dot; each dash (-) adds one whole beat. Use this to check whether a
	// measure fills its time signature.
	function noteDuration(n) {
		let base = 1 / Math.pow(2, n.ul)
		for (let d = 0; d < n.dt; d++) base *= 1.5
		base += n.ds
		return base
	}
	function groupDuration(g) {
		// A tied/chord group's duration is its longest member (notes sound together,
		// or are tied as one sustained value — both cases the group spans one value).
		// In this notation a "+"-tied group sums the tied values, so sum is correct;
		// single-note groups reduce to that note.
		return g.reduce((s, n) => s + noteDuration(n), 0)
	}
	function measureDuration(text) {
		return parseMeasure(text).reduce((s, g) => s + groupDuration(g), 0)
	}

	// Structural markers that carry no musical time.
	function isMarker(text) {
		const t = (text || "").trim()
		return t === "" || t === "|:" || t === ":|"
	}

	// Validate a single measure against an expected beats-per-bar (e.g. 4 for 4/4).
	// Returns { ok, beats, expected, diff }. Markers are treated as ok.
	function validateMeasure(text, beatsPerBar = 4) {
		if (isMarker(text)) return { ok: true, beats: 0, expected: beatsPerBar, diff: 0, marker: true }
		const beats = measureDuration(text)
		const diff = beats - beatsPerBar
		return { ok: Math.abs(diff) < 1e-9, beats, expected: beatsPerBar, diff }
	}

	// Validate every measure of a part. Returns the list of offending measures:
	// [{ index, beats, diff, text }]. Empty array means the part is metrically sound.
	function findBadMeasures(measures, beatsPerBar = 4) {
		const bad = []
		measures.forEach((m, index) => {
			const r = validateMeasure(m, beatsPerBar)
			if (!r.ok) bad.push({ index, beats: r.beats, diff: r.diff, text: m })
		})
		return bad
	}

	return {
		parseNote,
		expandTok,
		parseMeasure,
		displayBeats,
		groupBeats,
		noteDuration,
		groupDuration,
		measureDuration,
		isMarker,
		validateMeasure,
		findBadMeasures,
	}
})
