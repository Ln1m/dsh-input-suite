/**
 * Scan the real skill tree, classify every skill entry, and report:
 *   - the curated mapping (which skill set owns which skill)
 *   - any overlap (a skill declared by two sets) -> hard error
 *   - any skill no rule classifies (stays visible; listed for curation)
 *   - the exact hide/keep split for a given set of active skill sets
 *
 * Usage:
 *   node tools/classify-report.mjs                 # mapping + health only
 *   node tools/classify-report.mjs sim data        # simulate those sets active
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  SKILL_SETS, SET_ORDER, ALWAYS_ON_SKILLS, skillIndex, resolveSkill, planVisibility,
} from "../lib/skill-sets.js";

// DSH registers skills from all three roots. A diagnostic that scans only the first
// one under-reports the real inventory (measured 2026-09-20: 162 files here vs 182
// registered -> 20 skills were invisible to this tool).
const SKILL_ROOTS = [
  path.join(os.homedir(), ".dsh", "skills"),
  path.join(os.homedir(), ".claude", "skills"),
  path.join(os.homedir(), ".agents", "skills"),
];

function readFrontmatter(file) {
  const txt = fs.readFileSync(file, "utf8");
  const m = txt.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const fm = m[1];
  const get = (k) => {
    const r = new RegExp("^" + k + ":\\s*(.+)$", "m").exec(fm);
    return r ? r[1].trim().replace(/^["']|["']$/g, "") : "";
  };
  const name = get("name");
  if (!name) return null; // reference/doc files carry no name:
  return { name, description: get("description"), set: get("skill-set") };
}

function scan() {
  const found = [];
  for (const root of SKILL_ROOTS) {
    if (!fs.existsSync(root)) continue;
    const walk = (dir) => {
      // A skill is a directory that owns a SKILL.md — that is the unit the host loads.
      // Every other .md inside it is a resource of that skill, not a second skill:
      // reading them all inflated this report by 37 phantom entries (measured
      // 2026-09-20: peer_reviewer_agent & co. live inside one skill's directory).
      const owner = path.join(dir, "SKILL.md");
      try {
        if (fs.statSync(owner).isFile()) {
          const fm = readFrontmatter(owner);
          if (fm) found.push({ ...fm, file: path.relative(root, owner) });
          return;
        }
      } catch {
        // no SKILL.md here -> container directory, keep walking
      }
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        const p = path.join(dir, e.name);
        // Follow symlinks/junctions like the host loader does (nodeEntryKind stats them).
        let isDir = e.isDirectory();
        if (!isDir && e.isSymbolicLink()) {
          try {
            isDir = fs.statSync(p).isDirectory();
          } catch {
            isDir = false;
          }
        }
        if (isDir) walk(p);
        else if (e.name.endsWith(".md")) {
          const fm = readFrontmatter(p);
          if (fm) found.push({ ...fm, file: path.relative(root, p) });
        }
      }
    };
    walk(root);
  }
  const uniq = new Map();
  for (const s of found) if (!uniq.has(s.name)) uniq.set(s.name, s);
  return [...uniq.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// `--registered=<file>`: validate against a runtime registration snapshot (a JSON
// array of skill names) instead of the filesystem. Plugins can register skills that
// have no file at all, so the file tree is NOT the registration set (measured
// 2026-09-20: 161 SKILL.md files vs 182 registered skills).
const regArg = process.argv.find((a) => a.startsWith("--registered="));
const skills = regArg
  ? JSON.parse(fs.readFileSync(regArg.slice("--registered=".length), "utf8"))
      .map((n) => ({ name: typeof n === "string" ? n : n.name, description: "", set: "", file: "(runtime snapshot)" }))
  : scan();

// `--names` / `--json`: bare machine-readable inventory for curation work.
if (process.argv.includes("--names")) {
  process.stdout.write(skills.map((s) => s.name).join("\n") + "\n");
  process.exit(0);
}
if (process.argv.includes("--json")) {
  process.stdout.write(JSON.stringify(skills, null, 2) + "\n");
  process.exit(0);
}

const idx = skillIndex();
console.log("=== SKILL INVENTORY (" + skills.length + " entries) ===");
let unclassified = 0;
for (const s of skills) {
  const set = resolveSkill(s.name, s.description, s.set);
  if (set === null) unclassified += 1;
  console.log("  " + String(set === null ? "UNCLASSIFIED" : set).padEnd(14)
    + s.name.padEnd(28) + (s.set ? "(frontmatter skill-set:" + s.set + ")" : ""));
}

console.log("\n=== CURATED MAPPING ===");
const declared = new Map();
let overlap = 0;
for (const id of SET_ORDER) {
  console.log("  " + id + " (" + SKILL_SETS[id].label + "): " + SKILL_SETS[id].skills.join(", "));
  for (const s of SKILL_SETS[id].skills) {
    if (declared.has(s)) {
      overlap += 1;
      console.log("    !! OVERLAP: " + s + " also in " + declared.get(s));
    }
    declared.set(s, id);
  }
}
console.log("  always-on: " + ALWAYS_ON_SKILLS.join(", "));

const missing = [...declared.keys(), ...ALWAYS_ON_SKILLS].filter((s) => !skills.some((x) => x.name === s));
console.log("\n=== HEALTH ===");
console.log("  overlap            : " + overlap);
console.log("  unclassified       : " + unclassified + (unclassified ? "  -> stay VISIBLE" : ""));
console.log("  declared-but-not-in-this-root: " + missing.length + (missing.length ? "  -> " + missing.join(", ") : ""));

const args = process.argv.slice(2);
const act = args.filter((a) => SKILL_SETS[a]);
if (args.length) {
  const plan = planVisibility(skills, act);
  console.log("\n=== SIMULATION: active = [" + (plan.active.join(", ") || "none") + "] ===");
  console.log("  visible (" + plan.kept.length + "): " + plan.kept.join(", "));
  console.log("  hidden  (" + plan.hidden.length + "): " + plan.hidden.join(", "));
  console.log("  unclassified kept: " + (plan.unclassified.join(", ") || "none"));
} else {
  const plan = planVisibility(skills, []);
  console.log("\n=== no active set -> nothing hidden (" + plan.kept.length + " visible) ===");
}
