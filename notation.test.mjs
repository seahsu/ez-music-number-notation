// Unit tests for the jianpu notation core.
//   Run:  node --test web/notation.test.mjs
//   (from the repo root; no dependencies, Node 18+).
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import notation from "./notation.js"

const { parseNote, parseMeasure, displayBeats, groupBeats, noteDuration, groupDuration, measureDuration, validateMeasure, findBadMeasures } = notation
const HERE = dirname(fileURLToPath(import.meta.url))

test("parseNote: underlines, octave dot and dot", () => {
	const n = parseNote("_0.")
	assert.equal(n.ul, 1)
	assert.equal(n.dt, 1)
	assert.equal(n.num, 0)
	assert.equal(n.type, "note")

	const h = parseNote("__'4")
	assert.equal(h.ul, 2)
	assert.equal(h.ou, 1)
	assert.equal(h.num, 4)
})

test("parseNote: dashes count, low octave, rhythm and flat chord", () => {
	assert.equal(parseNote("7---").ds, 3)
	assert.equal(parseNote("6.").od ?? 0, 0) // trailing dot is augmentation, not low octave
	assert.equal(parseNote(",6").od, 1)
	assert.equal(parseNote("x").type, "rhythm")
	assert.equal(parseNote("bB").chord, "Bb")
	assert.equal(parseNote("Gm7").chord, "Gm7")
})

test("displayBeats is layout-only (dot = +0.5), noteDuration is musical (dot = x1.5)", () => {
	const dottedEighth = parseNote("_0.")
	assert.equal(displayBeats(dottedEighth), 1.0) // 0.5 + 0.5  → 1 slot wide
	assert.equal(noteDuration(dottedEighth), 0.75) // 0.5 * 1.5 → true value

	const whole = parseNote("7---")
	assert.equal(noteDuration(whole), 4) // quarter + 3 dashes
})

test("groupDuration sums a +-tied group", () => {
	// "_'2+__'2": eighth (0.5) tied to sixteenth (0.25)
	const groups = parseMeasure("_'2+__'2")
	assert.equal(groups.length, 1)
	assert.equal(groupDuration(groups[0]), 0.75)
})

test("REGRESSION: the reported measure 1 is a valid 4-beat bar (data was never wrong)", () => {
	const m1 = "_0. __'4 __'3 __'4 _'2+__'2 __'4 __'3 __'4 7"
	assert.equal(measureDuration(m1), 4)
	assert.equal(validateMeasure(m1, 4).ok, true)

	// Its displayBeats total is 4.25 — that mismatch is purely a layout-width artifact,
	// NOT extra musical time. Documents why the bar *looked* overfull before the CSS fix.
	const displayTotal = parseMeasure(m1).reduce((s, g) => s + groupBeats(g), 0)
	assert.equal(displayTotal, 4.25)
})

test("cross-measure tie: _tieOut on sender, NO _tieIn on receiver (score convention)", () => {
	// This score uses only trailing '+' for ties. The continuation measure's first
	// note carries no leading '+', so _tieIn is always undefined. The playback fix
	// must extend on the first group even without _tieIn.
	const sender = parseMeasure(",2.--. _,5+")
	const receiver = parseMeasure(",5.-- _,6+")
	assert.equal(sender[sender.length - 1]._tieOut, true, "sender last group must have _tieOut")
	assert.equal(receiver[0]._tieIn, undefined, "receiver first group has NO _tieIn (score convention)")
	// Pitch key of sender's last note and receiver's first note must match for the
	// playback engine to extend (it checks groupIdx === 0 as the implied tie-in condition).
	// Both are ',5' — same scale degree and octave marker, so they match.
	assert.equal(sender[sender.length - 1][0].num, 5)
	assert.equal(receiver[0][0].num, 5)
})

test("validateMeasure flags an over-full bar and treats markers as ok", () => {
	const tooLong = validateMeasure("1 2 3 4 5", 4) // 5 quarter notes
	assert.equal(tooLong.ok, false)
	assert.equal(tooLong.beats, 5)
	assert.equal(validateMeasure("|:", 4).ok, true)
	assert.equal(validateMeasure(":|", 4).ok, true)
	assert.equal(validateMeasure("", 4).ok, true)
})

// Whole-file metric check: every measure of the reported song must fill 4/4.
// Skips gracefully if the sample file is not present.
test("sample file 'Veridis Quo (7).json' is metrically sound in 4/4", () => {
	const file = join(HERE, "Veridis Quo (7).json")
	if (!existsSync(file)) {
		console.warn("  (skipped — sample JSON not present)")
		return
	}
	const data = JSON.parse(readFileSync(file, "utf8"))
	for (const part of data.parts) {
		const bad = findBadMeasures(part.measures, 4)
		const detail = bad.map((b) => `m${b.index + 1}=${b.beats}`).join(", ")
		assert.equal(bad.length, 0, `part "${part.name}" has non-4-beat measures: ${detail}`)
	}
})
