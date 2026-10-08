/**
 * dsh-skill-sets -- host half.
 *
 * PURPOSE
 *   Make a session's visible SKILL LIST depend on the active "skill sets" (技能档).
 *     - always-on skills + the skills of every active set stay visible
 *     - every other skill gets a hidden shadow at that agent's scope, which blocks
 *       BOTH the catalog entry and the skill body (name-level shadow, near layer wins)
 *     - with NO active set nothing is hidden -> exactly the previous behaviour
 *
 * NAMING
 *   A skill set only decides which skills
 *   are loaded and adds a short working brief. It never restates identity.
 *
 * MECHANICS (each verified against this checkout)
 *   - `agent/created` listeners must register SYNCHRONOUSLY: the emit does not await.
 *   - registrations go through `agent.ctx.get(name).…` so the traceable proxy rebinds
 *     `this.ctx` to the caller and the rows land in that agent's scope layer, which
 *     outranks every global/preset layer for the same skill name.
 *   - `skills.list()` is ASYNC and takes `{scope, cwd, signal}`; without `scope: agent`
 *     it only sees the global layer and returns nothing for a session.
 *   - same-layer duplicate registration is first-wins with a no-op disposer, so the
 *     previous shadow MUST be disposed before re-registering.
 *   - `section`/`context` accept a lazy text function: a changed string is added once,
 *     an unchanged one adds no message, and an empty one is dropped entirely.
 *   - the skill catalog is snapshotted inside `agent/pre-step` AFTER `next()`, so we
 *     settle our shadows before calling `next()` and the very first catalog is correct.
 */
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { defineTool } from "@deepseek-ai/dsh-tools";
import {
  SKILL_SETS, SET_ORDER, ALWAYS_ON_SKILLS, SET_ALIASES, resolveSetId,
  planVisibility, briefFor, setLabel,
} from "./skill-sets.js";

export const name = "dsh-skill-sets";
/** `agents` is only for the boot-time back-fill; agent-side reads always go through agent.ctx.get(). */
export const inject = ["tools", "agents", "webServer"];

/** The GUI routes the client half talks to (a self-written plugin cannot add RPC namespaces). */
export const ROUTE_STATE = "/skill-sets/api/state";
export const ROUTE_SET = "/skill-sets/api/set";
export const ROUTE_LIBRARY = "/skill-sets/api/library";
/**
 * One route for every per-set option (settings page):
 *   { set, skill, on }        flip ONE skill of that set
 *   { set, skills: [...] }    replace that set's off-list
 *   { set, denyTools: [...] } replace that set's denied-tool list (opt-in, [] = none)
 *   { set, preset: "id" }     bind an agent preset to that set ("" = unbind)
 *   { auditSeconds: n }       host-wide shadow-audit interval (0 = off)
 */
export const ROUTE_SET_SKILLS = "/skill-sets/api/set-skills";
/** Agent-preset ids the settings page may bind to a set (empty when the service is absent). */
export const ROUTE_PRESETS = "/skill-sets/api/presets";

const CONFIG_PATH = join(homedir(), ".dsh", "skill-sets.json");
const SECTION_NAME = "host:skill-sets-brief";
const CONTEXT_NAME = "host:skill-sets-state";
const SOURCE = "dsh-skill-sets";
/** Description of our own shadow rows — the audit uses it to tell a shadow from a real skill. */
const SHADOW_DESCRIPTION = "(hidden by skill set)";
const DEFAULT_AUDIT_SECONDS = 20;

/** agent -> { shadows: Map<name, dispose>, shadowsKey, section, context, toolRestricts, auditedAt } */
const installed = new WeakMap();
/** sessionId -> [setId] */
const activeBySession = new Map();
/**
 * sessionId -> 自动路由的「建议加开」档位。**已退役（2026-09-21）**：脚本路由
 * （关键词自动开档 + 两种注入气泡）按用户指令整段撤除，首轮定档改由模型读
 * `~/.dsh/AGENTS.md › skill-set-first-turn` 后自己调 `skill_set` 完成。
 * 这张表保留为空集，只为不打破 GUI `suggested` 字段的契约 —— dock 据此给档位卡片
 * 加虚线提示（现在永远不会高亮）。
 */
const suggestedBySession = new Map();
/**
 * sessionId -> 本次 model-visible surface 里「真人发言」的条数（注入的 reminder、
 * 工具结果、插件上下文都不算）。首轮闸门按**轮**判定，就靠这个数字。
 *
 * 用户铁律（2026-09-21）：**只有首轮允许自主切换档位**，之后只能建议、由用户点面板确认。
 * 这里的「首轮」= 第一次对话（第 1 个 turn）里的**每一个 step**。
 * 旧实现按 pre-step 次数算（`> 1` 即关闭），导致首轮里模型只要先调一次工具，
 * 第 2 个 step 就被判成第 2 轮 —— 实测（2026-09-21 本插件自己的会话）模型因此
 * 永远无法在第 1 轮里自开档。按轮判定的证据来自会话投影本身，重启不影响。
 * 宁可放行一次，也绝不把用户卡死在无法开档的会话里。
 */
const userPromptsBySession = new Map();
/** sessionId -> live agent (for the GUI routes, which only receive a session id) */
const agentsBySession = new Map();
/**
 * setId -> Set<skillName> switched OFF inside that set ONLY. A skill is never
 * muted globally: it stays visible through every other set that contributes it,
 * and `always` skills are not in any set, so they can never be switched off.
 */
const disabledBySet = new Map();
/**
 * setId -> Set<toolName> denied for that set's sessions (OPT-IN: empty by default,
 * so the tool surface is untouched until a tool is named in the settings page).
 */
const denyToolsBySet = new Map();
/** setId -> agent preset id this set composes the session from (""/absent = leave alone). */
const presetBySet = new Map();
/** Shadow audit interval in seconds (0 disables the audit). */
let auditSeconds = DEFAULT_AUDIT_SECONDS;
const EMPTY_SKILLS = new Set();
let saveChain = Promise.resolve();
let ready = Promise.resolve();

const OBJ_SCHEMA = { type: "object", additionalProperties: true };

function sessionIdOf(agent) {
  return agent?.id ?? agent?.session?.id ?? "";
}

function setsOf(agent) {
  const sid = sessionIdOf(agent);
  if (!sid) return [];
  // A session with its OWN entry always wins - including an EMPTY list, which is the
  // explicit "no set here" override. Only a never-configured session falls back to the
  // configured `defaultSets`, so a fresh session starts with the useful skills already
  // visible instead of needing a mid-conversation switch (that switch rewrites the
  // injected catalog, invalidating the cached prompt prefix of the whole conversation
  // and costing far more than the extra catalog tokens it saves).
  if (activeBySession.has(sid)) return activeBySession.get(sid);
  return defaultSets;
}

/** Skills switched off inside one set (empty Set when nothing is off). */
function disabledFor(id) {
  return disabledBySet.get(id) || EMPTY_SKILLS;
}

/** Tools denied for one set (empty Set when nothing is denied). */
function deniedToolsFor(id) {
  return denyToolsBySet.get(id) || EMPTY_SKILLS;
}

/** The preset one active list binds, in SET_ORDER priority: the first bound set wins. */
function boundPresetOf(act) {
  for (const id of SET_ORDER) {
    if (!act.includes(id)) continue;
    const preset = presetBySet.get(id);
    if (preset) return preset;
  }
  return "";
}

/** The skills one set actually contributes: its curated list minus the off-switches. */
function effectiveSkills(id) {
  const off = disabledFor(id);
  return SKILL_SETS[id].skills.filter((s) => !off.has(s));
}

/**
 * The key moves when anything that shapes the agent's visible surface changes:
 * the active sets, their per-set off-switches, their denied tools, or the preset
 * one of them binds.
 */
function setsKey(agent) {
  const act = [...setsOf(agent)].sort();
  return act
    .map((id) => id + ":" + [...disabledFor(id)].sort().join("+"))
    .join(",") + "|deny:" + act.map((id) => [...deniedToolsFor(id)].sort().join("+")).join(",")
    + "|preset:" + boundPresetOf(act);
}

function renderJson(args, value) {
  return [{ type: "text", text: JSON.stringify(value, null, 2) }];
}

// ------------------------------------------------------------------ config ---

/**
 * Sets every NEW session starts with (opt-in via `defaultSets` in the config file).
 * Chosen once and then left alone: switching sets mid-conversation rewrites the
 * injected catalog and invalidates the cached prompt prefix of the conversation.
 */
let defaultSets = [];

async function loadConfig() {
  try {
    const doc = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
    for (const [sid, sets] of Object.entries(doc?.sessions || {})) {
      if (!Array.isArray(sets)) continue;
      // Keep an empty list too: it is the explicit per-session override that
      // switches the default sets off for that session.
      // 改版后老会话存的旧档 id 在这里过一遍别名（见 skill-sets.js 的 SET_ALIASES），
      // 否则老会话会因为 SKILL_SETS[s] 落空而静默丢掉整个技能面。
      activeBySession.set(sid, sets.map(resolveSetId).filter((s) => SKILL_SETS[s]));
    }
    if (Array.isArray(doc?.defaultSets)) {
      defaultSets = [...new Set(doc.defaultSets.map((s) => resolveSetId(String(s).trim())))]
        .filter((id) => SKILL_SETS[id]);
    }
    // 旧档 → 新档的「关掉的技能 / 拒绝的工具 / 绑定预设」一并搬过去，新档里已有条目优先。
    const migrateKey = (map) => {
      for (const [id, value] of [...map]) {
        const next = resolveSetId(id);
        if (next === id || !SKILL_SETS[next]) continue;
        if (!map.has(next)) map.set(next, value);
        map.delete(id);
      }
    };
    migrateKey(disabledBySet);
    migrateKey(denyToolsBySet);
    migrateKey(presetBySet);
    // Per-set switches: { "data": { "disabled": ["x"] } } — a bare array is accepted too.
    for (const [setId, entry] of Object.entries(doc?.sets || {})) {
      if (!SKILL_SETS[setId]) continue;
      const raw = Array.isArray(entry) ? entry : entry?.disabled;
      if (Array.isArray(raw)) {
        const known = new Set(SKILL_SETS[setId].skills);
        const off = raw.map((s) => String(s)).filter((s) => known.has(s));
        if (off.length) disabledBySet.set(setId, new Set(off));
      }
      const tools = entry?.denyTools;
      if (Array.isArray(tools) && tools.length) {
        denyToolsBySet.set(setId, new Set(tools.map((t) => String(t).trim()).filter(Boolean)));
      }
      const preset = typeof entry?.preset === "string" ? entry.preset.trim() : "";
      if (preset) presetBySet.set(setId, preset);
    }
    const seconds = Number(doc?.auditSeconds);
    if (Number.isFinite(seconds) && seconds >= 0) auditSeconds = seconds;
  } catch {
    /* first run: no config yet */
  }
}

function saveConfig() {
  const doc = {
    sessions: Object.fromEntries(activeBySession),
    // Written back verbatim so the defaults survive every later save.
    ...(defaultSets.length ? { defaultSets } : {}),
    // Only sets carrying something are written, so the file stays readable.
    sets: Object.fromEntries(
      [...new Set([...disabledBySet.keys(), ...denyToolsBySet.keys(), ...presetBySet.keys()])]
        .map((id) => {
          const off = disabledBySet.get(id);
          const deny = denyToolsBySet.get(id);
          const preset = presetBySet.get(id);
          return [id, {
            ...(off && off.size ? { disabled: [...off].sort() } : {}),
            ...(deny && deny.size ? { denyTools: [...deny].sort() } : {}),
            ...(preset ? { preset } : {}),
          }];
        })
        .filter(([, entry]) => Object.keys(entry).length),
    ),
    auditSeconds,
  };
  saveChain = saveChain.then(async () => {
    try {
      await mkdir(dirname(CONFIG_PATH), { recursive: true });
      await writeFile(CONFIG_PATH, JSON.stringify(doc, null, 2), "utf8");
    } catch {
      /* silent: a lost preference must never break a session */
    }
  });
  return saveChain;
}

// ------------------------------------------------------------- visibility ---

/** Last catalog seen per agent (names only). WeakMap, so a disposed agent is collected. */
const catalogs = new WeakMap();

const manualOnlyByAgent = new WeakMap();

function catalogOf(agent) {
  try {
    return catalogs.get(agent) || [];
  } catch {
    return [];
  }
}

/** All skills the VIEWING agent can see (needs scope: agent, hence async). */
async function allSkillsOf(agent, signal) {
  try {
    const skills = agent.ctx.get("skills");
    if (!skills?.list) return [];
    const list = await skills.list({
      scope: agent,
      cwd: agent.session?.header?.cwd,
      signal,
    });
    const mapped = (list || []).map((s) => ({
      name: s.name,
      description: s.description || "",
      modelInvocable: !(s.invocation && s.invocation.modelInvocable === false),
    }));
    catalogs.set(agent, mapped.map((s) => s.name));
    manualOnlyByAgent.set(agent, new Set(mapped.filter((s) => !s.modelInvocable).map((s) => s.name)));
    return mapped;
  } catch (error) {
    return [];
  }
}

/**
 * Cache setter for the last catalog seen on this agent. `allSkillsOf` already writes
 * the live read; this exists for the pre-shadow snapshot and MUST stay defined - an
 * undefined call here throws inside `ensureShadows`, which silently kills every
 * shadow registration and leaves the whole plugin looking dead (2026-09-10 bug).
 */
function pushCatalog(agent, list) {
  try {
    catalogs.set(agent, (list || []).map((s) => (typeof s === "string" ? s : s.name)));
  } catch {
    /* a cache write must never break a turn */
  }
}

function disposeShadows(entry) {
  for (const dispose of entry.shadows.values()) {
    try {
      dispose?.();
    } catch {
      /* already gone */
    }
  }
  entry.shadows.clear();
  for (const dispose of entry.toolRestricts || []) {
    try {
      dispose?.();
    } catch {
      /* already gone */
    }
  }
  if (entry.toolRestricts) entry.toolRestricts.length = 0;
}

/**
 * How many steps an unsettled tool deny may be retried before the plugin gives up.
 * A retry is cheap (no token cost, no catalog change) but must not loop forever.
 */
const MAX_TOOL_DENY_TRIES = 5;

/**
 * Deny the active sets' tools for this agent (opt-in; nothing denied = nothing done).
 * `tools.restrict` is scoped, so it must be called through the AGENT's context.
 *
 * Returns true only when the deny state is SETTLED for `entry`: applied successfully,
 * empty, or abandoned after MAX_TOOL_DENY_TRIES. Returning false means "retry later".
 * The old `return`-on-not-ready form was silent AND the caller still locked the plan,
 * so a first step that ran before `tools.restrict` was reachable left the whole session
 * und-enied (2026-09-10 round 3: 8 mnemon_* tools came back for an entire session,
 * measured +4,403 chars / ~1,498 tok per request). Settling must therefore be reported,
 * not assumed. An unknown/stale tool name must still never break the turn.
 */
const DIAG_PATH = process.env.DSH_SKILLSETS_DIAG || join(homedir(), ".dsh", "logs", "skill-sets-deny.log");

/**
 * Round-3 diagnosis: this deny path reported success while the tool surface never changed,
 * so record what the plugin actually saw at each step. Runs only when a deny list changes
 * (twice per session at most). Delete the block once the cause is closed.
 */
/**
 * 单文件日志上限（2026-09-11 用户要求：清修「日志无轮转」）。超过就整份改名为 `<日志>.1`
 * （覆盖上一次的 .1），总量因此有界；写入路径上的任何失败都不得影响本轮执行。
 */
const DIAG_MAX_BYTES = 1024 * 1024;

function rotateLog(path, maxBytes) {
  try {
    if (statSync(path).size > maxBytes) renameSync(path, `${path}.1`);
  } catch {
    /* 文件还不存在 / 正被占用：跳过轮转 */
  }
}

function diag(line) {
  try {
    mkdirSync(dirname(DIAG_PATH), { recursive: true });
    rotateLog(DIAG_PATH, DIAG_MAX_BYTES);
    appendFileSync(DIAG_PATH, `${new Date().toISOString()} pid=${process.pid} ${line}\n`, "utf8");
  } catch {
    /* diagnostics must never break a turn */
  }
}

/** Probe the scoped view without touching the registry. */
function visibleProbe(tools, agent) {
  try {
    const view = tools?.view?.(agent.ctx);
    if (!view) return "no-view";
    const vis = view.visible;
    const arr = vis instanceof Map ? [...vis.keys()] : vis ? [...vis] : [];
    return `${arr.length} names${arr.includes("mnemon_forget") ? ", HAS mnemon_forget" : ", no mnemon_forget"}`;
  } catch (error) {
    return `view-threw ${String(error).slice(0, 80)}`;
  }
}

function applyToolDeny(ctx, agent, entry) {
  const act = setsOf(agent);
  const deny = [...new Set(act.flatMap((id) => [...deniedToolsFor(id)]))].sort();
  const key = deny.join(",");
  if (entry.toolDenyKey === key) return true; // already settled for this deny list
  diag(`applyToolDeny act=[${act.join("+")}] deny=${deny.length}`);
  if (!deny.length) {
    entry.toolDenyKey = key;
    diag("  empty deny -> settled with nothing to do");
    return true;
  }
  const giveUp = () => {
    entry.toolDenyKey = key; // settled as "unavailable": never retry forever
    entry.toolDenyTries = 0;
    diag("  GIVE UP: marked settled WITHOUT applying");
    return true;
  };
  try {
    const tools = agent.ctx.get("tools");
    if (!tools?.restrict) {
      entry.toolDenyTries = (entry.toolDenyTries || 0) + 1;
      diag(`  no restrict fn: tools=${tools ? Object.keys(tools).join("|").slice(0, 200) : "undefined"} try=${entry.toolDenyTries}`);
      if (entry.toolDenyTries >= MAX_TOOL_DENY_TRIES) {
        ctx.logger?.warn?.(
          `skill-sets: tools.restrict unreachable after ${entry.toolDenyTries} steps; tool deny NOT applied (${deny.length} tools)`,
        );
        return giveUp();
      }
      return false; // retry on the next step
    }
    // dsh-tools `restrict({deny})` throws AS A WHOLE when ANY name is not a known
    // global tool at that moment, so a single stale name voids the entire deny list.
    // Measured 2026-09-10 round 3: `ralph` + `workflow` stayed in denyTools after the
    // lean preset removed their tool rows, and every session then ran und-enied (59
    // tools instead of 51, +9,626 chars / ~3,274 tok per request). Measured again
    // 2026-09-11: the saved config carried three names no plugin registers
    // (context_audit / deck_build / md_html_render), so EVERY recompute logged a
    // failed batch and fell back to 13 per-name restricts.
    // Fix: drop names the live registry does not know BEFORE the batch call, using the
    // same list `restrict` validates against (`tools.view(scope).restrictableNames`).
    // The per-name fallback stays for the case where `view` itself is unreachable.
    let denyNames = deny;
    let droppedNames = [];
    try {
      const knownNames = tools.view(agent.ctx)?.restrictableNames;
      if (knownNames && typeof knownNames.has === "function") {
        denyNames = deny.filter((name) => knownNames.has(name));
        droppedNames = deny.filter((name) => !knownNames.has(name));
      }
    } catch { /* view unavailable: keep the raw list and the batch-then-per-name path */ }
    if (droppedNames.length) {
      diag(`  dropped unknown tool names: [${droppedNames.join(",")}] kept ${denyNames.length}/${deny.length}`);
    }
    if (!denyNames.length) {
      // Every configured name is unknown to this deployment: nothing to deny, and
      // retrying would only re-log. Settle so the plan can lock.
      entry.toolDenyKey = key;
      entry.toolDenyTries = 0;
      diag("  nothing left to deny after the known-tool filter -> settled");
      ctx.logger?.warn?.(
        `skill-sets: denyTools names no known tool and were ignored: ${droppedNames.join(", ")}`,
      );
      return true;
    }
    let applied = false;
    diag(`  restrict=${typeof tools.restrict} view=${typeof tools.view} before: ${visibleProbe(tools, agent)}`);
    try {
      entry.toolRestricts.push(tools.restrict({ deny: denyNames }));
      applied = true;
      diag(`  batch ok; after: ${visibleProbe(tools, agent)}`);
    } catch (batchError) {
      diag(`  BATCH FAILED: ${String(batchError).slice(0, 240)}`);
      const skipped = [];
      for (const name of denyNames) {
        try {
          entry.toolRestricts.push(tools.restrict({ deny: [name] }));
        } catch (error) {
          skipped.push(name);
          diag(`    per-name ${name} FAILED: ${String(error).slice(0, 120)}`);
        }
      }
      diag(`  per-name done: applied=${denyNames.length - skipped.length} skipped=[${skipped.join(",")}] after: ${visibleProbe(tools, agent)}`);
      ctx.logger?.warn?.(
        `skill-sets: batch tool deny failed (${String(batchError)}); applied per name` +
          (skipped.length ? `, skipped unknown: ${skipped.join(", ")}` : ""),
      );
      // Any skipped name means the batch was not fully applied, so report unsettled and
      // let the next step retry: ensureShadows disposes the previous restricts first, so
      // retries never accumulate. giveUp() caps the loop at MAX_TOOL_DENY_TRIES.
      applied = skipped.length === 0;
    }
    if (applied) {
      entry.toolDenyKey = key;
      entry.toolDenyTries = 0;
    } else {
      // 2026-09-11 修复：未完全生效时**不能**标记已结算。旧代码无条件置 toolDenyKey，
      // 配合 ensureShadows 的 disposeShadows（先释放已应用的 restrict）与 `toolDenyKey === key`
      // 早返回，会让该档最终一条工具都不裁剪、且计划被锁定（静默失效）。
      entry.toolDenyTries = (entry.toolDenyTries || 0) + 1;
      if (entry.toolDenyTries >= MAX_TOOL_DENY_TRIES) return giveUp();
    }
    return applied;
  } catch (error) {
    entry.toolDenyTries = (entry.toolDenyTries || 0) + 1;
    diag(`  OUTER CATCH: ${String(error).slice(0, 240)}`);
    ctx.logger?.warn?.(`skill-sets: could not restrict tools ${deny.join(", ")}: ${String(error)}`);
    if (entry.toolDenyTries >= MAX_TOOL_DENY_TRIES) return giveUp();
    return false; // retry on the next step
  }
}

/**
 * Compose the session from the preset a bound set names (opt-in). A no-op when no
 * active set binds one, or when the agent already runs that preset.
 */
async function applyPreset(ctx, agent, entry) {
  const wanted = boundPresetOf(setsOf(agent));
  if (!wanted || entry.presetApplied === wanted) return;
  let presets;
  try {
    presets = agent.ctx.get("agentPresets");
  } catch {
    return;
  }
  if (!presets?.recompose) return;
  try {
    if (presets.composedPreset?.(agent.ctx)?.id === wanted) {
      entry.presetApplied = wanted;
      return;
    }
    await presets.recompose(agent.ctx, wanted);
    entry.presetApplied = wanted;
  } catch (error) {
    ctx.logger?.warn?.(`skill-sets: could not compose preset "${wanted}": ${String(error)}`);
  }
}

/**
 * Bring the hidden shadows in line with the active sets for one agent.
 * Skips work when nothing changed unless `force` is set. Returns a plan or null.
 */
async function ensureShadows(ctx, agent, signal, force = false) {
  const entry = installed.get(agent);
  if (!entry) return null;
  const key = setsKey(agent);
  if (!force && entry.shadowsKey === key) return null;
  diag(`ensureShadows recompute force=${force} sets=[${setsOf(agent).join("+")}]`);

  disposeShadows(entry); // must precede the listing: removes our own shadows from view
  const sets = setsOf(agent);
  const all = await allSkillsOf(agent, signal);
  if (!all.length) {
    entry.shadowsKey = null; // could not read the catalog; retry on the next step
    return null;
  }
  // Our own name-level shadows were just dropped, so this read saw EVERY skill
  // (the agent's whole catalog). Re-read once with the new shadows in place so the
  // displayed totals/`skillNames`/`hidden` describe one and the same state.
  pushCatalog(agent, all);
  const plan = planVisibility(all, sets, disabledBySet);
  let skills;
  try {
    skills = agent.ctx.get("skills");
  } catch {
    entry.shadowsKey = null;
    return plan;
  }
  for (const skillName of plan.hidden) {
    try {
      const dispose = skills.register({
        name: skillName,
        description: SHADOW_DESCRIPTION,
        content: "",
        source: SOURCE,
        invocation: { modelInvocable: false, userInvocable: false },
      });
      entry.shadows.set(skillName, dispose);
    } catch (error) {
      ctx.logger?.warn?.(`skill-sets: could not shadow "${skillName}": ${String(error)}`);
    }
  }
  const denySettled = applyToolDeny(ctx, agent, entry);
  await applyPreset(ctx, agent, entry);
  // Only a SETTLED deny may lock the plan. An unsettled one (tools.restrict not yet
  // reachable) leaves `shadowsKey` open so the next pre-step retries it, instead of
  // silently running the whole session with the denied tools still visible.
  entry.shadowsKey = denySettled ? key : null;
  entry.auditedAt = Date.now();
  return plan;
}

/**
 * Leak guard: a skill installed or edited WHILE a session runs changes no set, so the
 * cached key cannot notice it. Re-plan when the live catalog shows a real (non-shadow)
 * skill that the active sets should be hiding. Runs at most every `auditSeconds`, and
 * only while at least one set is active, so a session with no set pays nothing.
 */
async function auditShadows(ctx, agent, signal) {
  const entry = installed.get(agent);
  if (!entry) return;
  if (!auditSeconds) return;
  const sets = setsOf(agent);
  if (!sets.length) return; // nothing is hidden -> nothing to leak
  const now = Date.now();
  if (now - (entry.auditedAt || 0) < auditSeconds * 1000) return;
  entry.auditedAt = now;
  let list;
  try {
    list = await allSkillsOf(agent, signal);
  } catch {
    return;
  }
  // Our own shadow rows carry a fixed description: drop them so only real skills remain.
  const real = (list || []).filter((s) => s.description !== SHADOW_DESCRIPTION);
  if (!real.length) return;
  const plan = planVisibility(real, sets, disabledBySet);
  if (!plan.hidden.length) return;
  ctx.logger?.info?.(
    `skill-sets: catalog changed, re-hiding ${plan.hidden.join(", ")}`,
  );
  await ensureShadows(ctx, agent, signal, true);
}

function stateLine(agent) {
  const sets = setsOf(agent);
  if (!sets.length) return "";
  return "技能档：" + sets.map(setLabel).join(" + ")
    + "（只加载该档技能；切换后本行会自动刷新）";
}

// ------------------------------------------------------------ lifecycle -----

function uninstall(agent) {
  const entry = installed.get(agent);
  if (!entry) return;
  const sid = sessionIdOf(agent);
  if (sid && agentsBySession.get(sid) === agent) agentsBySession.delete(sid);
  if (sid) suggestedBySession.delete(sid);
  if (sid) userPromptsBySession.delete(sid);
  installed.delete(agent);
  disposeShadows(entry);
  for (const dispose of [entry.section, entry.context]) {
    try {
      dispose?.();
    } catch {
      /* ignore */
    }
  }
}

/** 一条 user 消息里的全部文本（只认真正的用户输入，不认注入的 system-reminder）。 */
function userTextOf(message) {
  try {
    if (!message || message.source?.kind !== "user") return "";
    const blocks = Array.isArray(message.content) ? message.content : [];
    const text = blocks
      .filter((b) => b && b.type === "text")
      .map((b) => String(b.text || ""))
      .join("\n")
      .trim();
    // 自己/历史注入的 system-reminder 不算用户输入：首轮闸门靠「真人发言条数」判定，
    // 把注入物算进去会让同一轮里凭空多出一条发言，把首轮资格算没。
    if (text.startsWith("<system-reminder>")) return "";
    return text;
  } catch {
    return "";
  }
}

/**
 * 自动切档已退役（2026-09-21，用户指令：不要脚本路由、规则写进 AGENTS.md）。
 *
 * 撤掉的三件东西：
 *   1. 关键词自动开档：`ROUTE_STRONG` 评分命中就在首轮静默 `applySets`
 *      （实测 72 条真实消息命中率仅 54.2%，pwm/死区/锁相/零食 一类全漏网）；
 *   2. 首轮注入的「【技能档 · 第一步】」气泡（旧 `injectSetPicker`）；
 *   3. 首轮之后注入的「技能档路由建议」气泡（旧 `autoroute` 中途分支）——
 *      就是用户明确嫌弃的那个对话框。
 * 备份：改动前先把原文件另存到安装根的 backups\ 下。
 *
 * 现在首轮定档是模型自己的固定动作（`~/.dsh/AGENTS.md › skill-set-first-turn` + skill_set 工具描述）；
 * 「只有首轮可切档」的硬闸门仍由工具侧强制（见 `makeTool`），不受本次撤除影响。
 */

/**
 * 历史里的旧版注入消息缺 `role`（已写进会话日志，改代码也修不掉），会让**每一次**
 * 请求都在同一个 messages[N] 上被 422 拒收、会话彻底不可用。pre-step 拿到的 messages
 * 就是要发给模型的那份 surface，所以在入口处就地补齐 role：老会话自动恢复。
 * 只在真的发现缺 role 的 user 消息时才返回改写后的数组，平时一律走 next()。
 */
function repairMissingRole(messages) {
  const list = Array.isArray(messages) ? messages : [];
  let hit = false;
  const fixed = list.map((message) => {
    if (message && !message.role && message.source?.kind === "user") {
      hit = true;
      return { ...message, role: "user" };
    }
    return message;
  });
  return hit ? fixed : null;
}

/** Synchronous registration of the prompt rows; shadows are settled separately. */
function install(ctx, agent) {
  uninstall(agent);
  let skills;
  let prompt;
  try {
    skills = agent.ctx.get("skills");
    prompt = agent.ctx.get("systemPrompt");
  } catch (error) {
    ctx.logger?.warn?.(`skill-sets: services unavailable: ${String(error)}`);
    return Promise.resolve();
  }
  if (!skills || !prompt) return Promise.resolve();

  const entry = {
    shadows: new Map(), shadowsKey: null, section: undefined, context: undefined,
    toolRestricts: [], toolDenyKey: null, toolDenyTries: 0,
    presetApplied: "", auditedAt: 0,
    /**
     * install 时刻该会话已有的 assistant 回复数（会话重启时来自 `snapshotEvents()` 的
     * 存储回放）。> 0 => 这不是首轮，首轮闸门直接关闭。见 `isFirstTurn`。
     */
    assistantAtInstall: 0,
  };
  try {
    const events = agent?.session?.snapshotEvents?.() || [];
    if (Array.isArray(events)) {
      entry.assistantAtInstall = events.filter((e) => e && e.type === "assistant/message").length;
    }
  } catch {
    entry.assistantAtInstall = 0; // 读不到就当首轮（宁可放行一次，也不卡死用户）
  }
  installed.set(agent, entry);
  const sid = sessionIdOf(agent);
  if (sid) agentsBySession.set(sid, agent);
  try {
    entry.section = prompt.section({
      name: SECTION_NAME,
      order: 5,
      text: () => briefFor(setsOf(agent)),
    });
    entry.context = prompt.context({
      name: CONTEXT_NAME,
      order: 116,
      text: () => stateLine(agent),
    });
  } catch (error) {
    ctx.logger?.warn?.(`skill-sets: prompt registration failed: ${String(error)}`);
  }
  return ensureShadows(ctx, agent, undefined, true);
}

/**
 * Apply a new active-set list to one agent; returns the resulting plan.
 * A manual switch (tool call or GUI panel) always persists; `persist = false` is
 * kept for internal callers that only need the in-memory switch.
 */
async function applySets(ctx, agent, ids, signal, persist = true) {
  const clean = [...new Set((ids || []).map(resolveSetId).filter((id) => SKILL_SETS[id]))];
  const sid = sessionIdOf(agent);
  if (!sid) return { active: [], hidden: [], kept: [], error: "no session id on this agent" };
  // In-memory for this process. A manual switch also persists it (below) so an
  // explicitly chosen list — including an empty one — survives a restart.
  activeBySession.set(sid, clean);
  // 退役的脚本路由留下的建议表：切档时一并清掉，别留半截状态。
  suggestedBySession.delete(sid);
  if (persist) saveConfig();
  const plan = await ensureShadows(ctx, agent, signal, true);
  return {
    active: clean,
    hidden: plan?.hidden ?? [],
    kept: plan?.kept ?? [],
    unclassified: plan?.unclassified ?? [],
  };
}

// ------------------------------------------------------------------ tools ---

function makeTool(ctx) {
  return defineTool({
    name: "skill_set",
    description:
      "管理本会话的「技能档」——控制哪些技能被加载（省上下文）。多档可叠加：可见技能 = 常驻技能 + 所有激活档的技能，其余技能在本会话被隐藏（目录与正文双封）。"
      + "用法：action=current 查看现状；action=list 列出全部档位与包含的技能；action=set 直接设定（sets 传完整清单或留空表示清空）；action=add / remove 增减。"
      + "**只有首轮可以自主切档**：读完用户第一句需求后立刻切到对应档（仿真/算数→sim，原理图 PCB/单片机→hardware，画图制图/导图→figure，论文/文献/文档转换→doc，写代码/排查报错/计划规格→dev，网页视觉/配图→design，DSH/脚本运维→ops，情绪陪伴/决策复盘/跑腿→life），跨领域时可多档叠加。"
      + "从第 2 轮起 set/add/remove/toggle 会被工具拒绝（这不是故障，是用户定的成本硬规矩）：此时只把「建议开 X 档」写进回复让用户拍板，不要重试，也别为此停下手里的活。"
      + "工具面裁剪（tools 拒绝名单）与每档绑定的 agent preset 属可选高级项，在「设置 → 技能档」里按档配置（默认关闭，不动任何工具与预设）。",
    parameters: {
      action: {
        type: "string",
        required: true,
        description: "current | list | set | add | remove | toggle",
      },
      sets: {
        type: "string",
        description: "档位 id，多个用逗号分隔，如 \"sim,doc\"。action=set 时传完整清单（留空=清空全部档位）",
      },
      skill: {
        type: "string",
        description: "action=toggle 时要开关的技能名，必须属于 sets 指定的那一档",
      },
      on: {
        type: "string",
        description: "action=toggle：true=启用（默认），false=在该档里关掉",
      },
    },
    output: { schema: OBJ_SCHEMA, render: renderJson },
    async execute(args, exec) {
      await ready;
      const agent = exec?.agent;
      if (!agent || !sessionIdOf(agent)) {
        return { error: "no agent/session in execution context" };
      }
      const signal = exec?.signal;
      if (!installed.has(agent)) await install(ctx, agent); // late/foreign agent (e.g. subagent)

      const action = String(args?.action || "current").trim().toLowerCase();
      const asked = String(args?.sets || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      // 首轮闸门（用户铁律 2026-09-21）：只有首轮允许模型自主改档，之后只出建议。
      // 拒绝是「软」的：返回一段可转达的建议而不是 error，模型因此不会重试或卡住。
      // 作用范围只含会改写注入目录/系统提示的动作；current / list / list 这类只读查询不受限。
      if (!["current", "list"].includes(action) && !isFirstTurn(agent)) {
        const want = asked.filter((id) => SKILL_SETS[id]);
        const labels = want.map(setLabel).join(" + ");
        const nowActive = setsOf(agent);
        return {
          declined: true,
          reason: "first-turn-only",
          active: nowActive,
          activeLabels: nowActive.map(setLabel),
          suggestion: want.length ? want : null,
          note:
            "已按用户定的规矩拒绝：本会话已过首轮，模型不得自行切档。"
            + (labels ? `建议内容：开「${labels}」档（可多档叠加）。` : "")
            + "请把这条建议直接告诉用户，由用户在「技能档」面板点选确认，或在需要新任务域时另开一个会话（新会话首轮由模型按 AGENTS.md › skill-set-first-turn 自己定档）。"
            + "不要重试本工具，也不要因此中断当前任务。",
        };
      }

      if (action === "list") {
        return {
          sets: SET_ORDER.map((id) => ({
            id,
            label: SKILL_SETS[id].label,
            skills: SKILL_SETS[id].skills,
            switchedOff: [...disabledFor(id)],
            denyTools: [...deniedToolsFor(id)],
            preset: presetBySet.get(id) || "",
            effectiveCount: effectiveSkills(id).length,
          })),
          alwaysOn: ALWAYS_ON_SKILLS,
          // 已退役档 id → 现役档（旧会话里存的档位会自动落到这里，不是报错）
          aliases: SET_ALIASES,
          active: setsOf(agent),
          // 路由建议表已退役，这里恒为空数组（字段保留只为 GUI 契约不变）
          suggested: suggestedBySession.get(sessionIdOf(agent)) || [],
          auditSeconds,
        };
      }

      if (action === "toggle") {
        const setId = asked[0];
        const name = String(args?.skill || "").trim();
        if (!SKILL_SETS[setId]) {
          return { error: `unknown set "${setId}"`, sets: SET_ORDER };
        }
        if (!SKILL_SETS[setId].skills.includes(name)) {
          return { error: `"${name}" is not in set "${setId}"`, skills: SKILL_SETS[setId].skills };
        }
        const on = String(args?.on ?? "true").trim().toLowerCase() !== "false";
        const off = new Set(disabledBySet.get(setId) || []);
        if (on) off.delete(name); else off.add(name);
        if (off.size) disabledBySet.set(setId, off); else disabledBySet.delete(setId);
        await saveConfig();
        await ensureShadows(ctx, agent, signal, true);
        const all = await allSkillsOf(agent, signal);
        const plan = planVisibility(all, setsOf(agent), disabledBySet);
        return {
          set: setId,
          skill: name,
          on,
          disabledInSet: [...disabledFor(setId)],
          effectiveCount: effectiveSkills(setId).length,
          active: plan.active,
          visibleCount: plan.kept.length,
          hiddenCount: plan.hidden.length,
          hidden: plan.hidden,
        };
      }

      if (action === "current") {
        const all = await allSkillsOf(agent, signal);
        const plan = planVisibility(all, setsOf(agent), disabledBySet);
        return {
          active: plan.active,
          activeLabels: plan.active.map(setLabel),
          suggested: suggestedBySession.get(sessionIdOf(agent)) || [],
          totalKnownSkills: all.length,
          visibleCount: plan.kept.length,
          hiddenCount: plan.hidden.length,
          visible: plan.kept,
          hidden: plan.hidden,
          unclassified: plan.unclassified,
          // Per-set switches only: they never mute a skill globally.
          switchedOff: Object.fromEntries(
            [...disabledBySet].filter(([, names]) => names.size).map(([id, names]) => [id, [...names]]),
          ),
          deniedTools: Object.fromEntries(
            [...denyToolsBySet].filter(([, names]) => names.size).map(([id, names]) => [id, [...names]]),
          ),
          preset: boundPresetOf(plan.active),
          auditSeconds,
        };
      }

      if (action === "set" || action === "add" || action === "remove") {
        const unknown = asked.filter((id) => !SKILL_SETS[id]);
        const current = setsOf(agent);
        let next;
        if (action === "set") next = asked;
        else if (action === "add") next = [...current, ...asked];
        else next = current.filter((id) => !asked.includes(id));
        const result = await applySets(ctx, agent, next, signal);
        return {
          active: result.active,
          activeLabels: result.active.map(setLabel),
          unknownIgnored: unknown,
          visibleCount: result.kept.length,
          hiddenCount: result.hidden.length,
          hidden: result.hidden,
        };
      }

      return { error: `unknown action "${action}"; use current|list|set|add|remove` };
    },
  });
}

// ------------------------------------------------------------- GUI routes ---
// A self-written plugin cannot add `api.<ns>.*` RPC, so the dock talks to these
// two same-origin routes instead (the dsh-wallet / dsh-restart-button pattern).

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * 当前 surface 里「真人发言」的条数：工具结果（source.kind = 'tool'）、我们注入的
 * system-reminder、插件上下文都不算 —— 只数真正的用户输入。
 */
function realUserPrompts(messages) {
  const list = Array.isArray(messages) ? messages : [];
  let count = 0;
  for (const message of list) if (message?.role === "user" && userTextOf(message)) count += 1;
  return count;
}

/**
 * 「本会话是否还在首轮」—— 首轮 = **第一次对话那一整个 turn**（含它的每个 step）。
 *
 * 判定基准是「轮」而不是「步」：一轮里模型可以调很多次工具，每个 step 都仍算首轮。
 * 旧实现按 pre-step 次数算（`> 1` 即关闭），于是首轮里模型先调一次工具（读技能目录等）
 * 就把自己的开档权关掉了 —— 用户点破的行为。判定证据：
 *   1. 本次 surface 里真人发言 <= 1 条（`realUserPrompts`）。数字来自会话投影，
 *      同一轮的多个 step 里不变，重启后由历史重放得出，天然不受重启影响。
 *   2. `install()` 时刻该会话已经有 assistant 回复（`entry.assistantAtInstall`）——
 *      覆盖投影被压缩/读不到时接手的老会话。
 *   3. 工具调用路径拿不到 messages，用 pre-step 里缓存的那个数字。
 * 反面教材（离线验证抓到）：曾把「持久化表 `activeBySession` 里已有该会话」也当证据 ——
 * 但 `applySets` 在首轮成功切档的那一刻就会写这张表，于是首轮切完一次后同一轮内立刻
 * 被误判为第 2 轮（测试 B2 实测失败）。任何「切档自身会产生」的痕迹都不能当证据。
 */
function isFirstTurn(agent, messages) {
  const sid = sessionIdOf(agent);
  if (!sid) return true;
  const entry = installed.get(agent);
  if (entry && entry.assistantAtInstall > 0) return false;
  const turns = Array.isArray(messages) ? realUserPrompts(messages) : userPromptsBySession.get(sid);
  if (typeof turns === "number") return turns <= 1;
  return true;
}

/** The agent of a live session, waiting briefly for one that is still booting. */
async function agentFor(sessionId) {
  const found = () => {
    const a = agentsBySession.get(sessionId);
    return a && installed.has(a) ? a : undefined;
  };
  let agent = found();
  for (let i = 0; !agent && i < 12; i += 1) {
    await sleep(120);
    agent = found();
  }
  return agent;
}

function statePayload(agent) {
  const sets = SET_ORDER.map((id) => ({
    id,
    label: SKILL_SETS[id].label,
    // One-line "what is this set for", drawn by the dock card. Lives in
    // lib/skill-sets.js so the label/hint pair is defined in exactly one place.
    hint: SKILL_SETS[id].hint || "",
    skills: effectiveSkills(id).length,
    disabled: [...disabledFor(id)],
  }));
  const base = { sets, alwaysOn: ALWAYS_ON_SKILLS, sessionId: agent ? sessionIdOf(agent) : "" };
  if (!agent) return { ...base, ok: false, error: "no-live-agent", active: [], total: 0, visible: 0 };
  const active = setsOf(agent);
  const entry = installed.get(agent);
  const hiddenCount = entry ? entry.shadows.size : 0;
  const catalog = catalogOf(agent);
  const manualOnly = manualOnlyByAgent.get(agent);
  const modelCatalogSize = Math.max(0, catalog.length - (manualOnly ? manualOnly.size : 0));
  // `total` comes from the last catalog read (catalogOf) and falls back to the
  // definition total + current shadows before the first read.
  const total = Math.max(modelCatalogSize, countVisible(active) + hiddenCount);
  return {
    ...base,
    ok: true,
    active,
    activeLabels: active.map(setLabel),
    total,
    visible: total - hiddenCount,
    hidden: [...(entry?.shadows.keys() ?? [])],
    // 脚本路由已退役：这张表恒为空，dock 的「建议加开」虚线提示不会再亮。
    suggested: suggestedBySession.get(sessionIdOf(agent)) || [],
    // The catalog as last read: the dock diffs it against `hidden` for its hover line.
    skillNames: catalog,
  };
}

/** How many skills stay visible for a given active list (always-on + set skills). */
function countVisible(active) {
  const seen = new Set(ALWAYS_ON_SKILLS);
  for (const id of active) {
    const off = disabledFor(id);
    for (const s of SKILL_SETS[id].skills) if (!off.has(s)) seen.add(s);
  }
  return seen.size;
}

/**
 * Exact-match JSON route. Always answers 200 with a JSON body, so the dock can
 * distinguish "route missing" (HTML) from a real plugin-level error.
 */
function jsonRoute(ctx, method, path, handler) {
  const webServer = ctx.get("webServer");
  if (!webServer) return;
  try {
    webServer.register({
      kind: "exact",
      path,
      handler: async (req, res) => {
        let result;
        try {
          if (req.method !== method) result = { ok: false, error: "method-not-allowed" };
          else result = await handler(req);
        } catch (error) {
          result = { ok: false, error: String((error && error.message) || error).slice(0, 300) };
        }
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(result));
      },
    });
  } catch (error) {
    ctx.logger?.warn?.(`skill-sets: could not register ${path}: ${String(error)}`);
  }
}

// -------------------------------------------------------------------- app ---

export function apply(ctx) {
  const warn = (message) => ctx.logger?.warn?.(`skill-sets: ${message}`);

  ctx.on("agent/created", ({ agent }) => {
    // Synchronous install on purpose: the emit does not await its listeners.
    Promise.resolve(install(ctx, agent)).catch((e) => warn(String(e)));
  });
  ctx.on("agent/disposed", ({ agent }) => {
    uninstall(agent);
  });

  // The catalog is snapshotted after `next()`, so settle the shadows first: this
  // guarantees the very first catalog of a session already honours the active sets.
  ctx.on("agent/pre-step", async ({ agent, messages, signal }, next) => {
    // 先修历史遗留：缺 role 的注入消息会让整个请求被 422 拒收。修好的数组必须
    // 一路传下去（最终返回值要用它），否则修改不生效。
    const repaired = repairMissingRole(messages);
    const list = repaired || messages;
    // 首轮闸门按「轮」判定：把本次 surface 里的真人发言条数缓存下来（工具调用路径
    // 拿不到 messages）。必须在模型本次动手前算好：模型在同一轮任一 step 调 skill_set
    // 读到的都必须是「本轮的步数」，而不是「进过几次 pre-step」。
    const preStepSid = sessionIdOf(agent);
    if (preStepSid) userPromptsBySession.set(preStepSid, realUserPrompts(list));
    try {
      await ensureShadows(ctx, agent, signal);
      await auditShadows(ctx, agent, signal);
    } catch (error) {
      warn(`pre-step shadow refresh failed: ${String(error)}`);
    }
    if (repaired) return { kind: "enter", messages: repaired };
    return next();
  });

  ctx.tools.register(makeTool(ctx));

  // ---------------------------------------------------------------- routes ---
  jsonRoute(ctx, "GET", ROUTE_STATE, async (req) => {
    const url = new URL(req.url || "/", "http://localhost");
    const sessionId = url.searchParams.get("session") || "";
    if (!sessionId) {
      return { ...statePayload(undefined), ok: false, error: "missing-session" };
    }
    const agent = await agentFor(sessionId);
    if (!agent) {
      // No live agent yet (fresh session): answer from the persisted preference so
      // the dock still renders the right selection.
      const sets = SET_ORDER.map((id) => ({
        id,
        label: SKILL_SETS[id].label,
        skills: effectiveSkills(id).length,
        disabled: [...disabledFor(id)],
      }));
      return {
        ok: true,
        pending: true,
        sets,
        alwaysOn: ALWAYS_ON_SKILLS,
        sessionId,
        active: activeBySession.get(sessionId) || [],
        total: 0,
        visible: 0,
        hidden: [],
      };
    }
    // The dock reads `skillNames`/`hidden` for its hover line; the catalog cache is
    // only filled by a visibility pass that changed something, so fill it here.
    if (!catalogOf(agent).length) await allSkillsOf(agent, undefined);
    return statePayload(agent);
  });

  jsonRoute(ctx, "POST", ROUTE_SET, async (req) => {
    let body = "";
    try {
      for await (const chunk of req) body += chunk;
    } catch {
      /* ignore a truncated body */
    }
    let parsed = {};
    try {
      parsed = body ? JSON.parse(body) : {};
    } catch {
      return { ok: false, error: "bad-json" };
    }
    const sessionId = typeof parsed.session === "string" ? parsed.session.trim() : "";
    if (!sessionId) return { ok: false, error: "missing-session" };
    const asked = Array.isArray(parsed.sets) ? parsed.sets : [];
    const clean = [...new Set(asked.map((s) => String(s).trim()))].filter((id) => SKILL_SETS[id]);

    const agent = await agentFor(sessionId);
    if (!agent) {
      // Persist anyway: `applySets` needs an agent, so mirror its bookkeeping and
      // let the next `agent/created` / `pre-step` pick the choice up.
      activeBySession.set(sessionId, clean);
      await saveConfig();
      return { ok: true, pending: true, active: clean, activeLabels: clean.map(setLabel) };
    }
    const result = await applySets(ctx, agent, clean, undefined);
    return { ...statePayload(agent), ok: true, active: result.active };
  });

  // Per-set options (settings page). The off-list is scoped to ONE set, so a
  // skill switched off in `data` stays visible the moment another active set
  // contributes it. `{ set, skill, on }` flips one entry; `{ set, skills: [...] }`
  // replaces the whole off-list; `denyTools` / `preset` set the other two knobs;
  // a bare `{ auditSeconds }` updates the host-wide audit interval.
  jsonRoute(ctx, "POST", ROUTE_SET_SKILLS, async (req) => {
    let body = "";
    try {
      for await (const chunk of req) body += chunk;
    } catch {
      /* ignore a truncated body */
    }
    let parsed = {};
    try {
      parsed = body ? JSON.parse(body) : {};
    } catch {
      return { ok: false, error: "bad-json" };
    }
    if (parsed.auditSeconds !== undefined) {
      const seconds = Number(parsed.auditSeconds);
      if (!Number.isFinite(seconds) || seconds < 0) return { ok: false, error: "bad-seconds" };
      auditSeconds = seconds;
      await saveConfig();
      return { ok: true, auditSeconds };
    }
    const setId = typeof parsed.set === "string" ? parsed.set.trim() : "";
    if (!SKILL_SETS[setId]) return { ok: false, error: "unknown-set" };
    const known = SKILL_SETS[setId].skills;
    const hasSkills = Array.isArray(parsed.skills) || typeof parsed.skill === "string";
    const hasTools = Array.isArray(parsed.denyTools);
    const hasPreset = typeof parsed.preset === "string";
    if (!hasSkills && !hasTools && !hasPreset) return { ok: false, error: "nothing-to-set" };

    if (hasSkills) {
      const asked = Array.isArray(parsed.skills)
        ? parsed.skills.map((s) => String(s).trim())
        : [String(parsed.skill ?? "").trim()];
      const names = asked.filter((s) => s && known.includes(s));
      if (!names.length) return { ok: false, error: "missing-skill" };
      const off = new Set(disabledBySet.get(setId) || []);
      if (parsed.on === undefined) off.clear(); // a bare list replaces the whole off-set
      for (const name of names) {
        if (parsed.on === undefined || parsed.on === false) off.add(name);
        else off.delete(name);
      }
      if (off.size) disabledBySet.set(setId, off);
      else disabledBySet.delete(setId);
    }
    if (hasTools) {
      const deny = [...new Set(parsed.denyTools.map((t) => String(t).trim()).filter(Boolean))];
      if (deny.length) denyToolsBySet.set(setId, new Set(deny));
      else denyToolsBySet.delete(setId);
    }
    if (hasPreset) {
      const preset = parsed.preset.trim();
      if (preset) presetBySet.set(setId, preset);
      else presetBySet.delete(setId);
    }
    await saveConfig();

    // Live sessions that have this set active must re-plan their shadows right now,
    // otherwise the switch would only take effect after a restart.
    for (const agent of agentsBySession.values()) {
      if (!setsOf(agent).includes(setId)) continue;
      try {
        await ensureShadows(ctx, agent, undefined, true);
      } catch (error) {
        warn(`refresh after set-skill toggle failed: ${String(error)}`);
      }
    }
    return {
      ok: true,
      set: setId,
      disabled: [...disabledFor(setId)],
      denyTools: [...deniedToolsFor(setId)],
      preset: presetBySet.get(setId) || "",
      on: effectiveSkills(setId).length,
      auditSeconds,
    };
  });

  // The settings section renders the whole taxonomy (name + description + skills),
  // so the slot definition lives in ONE place (lib/skill-sets.js) and is never
  // duplicated in the client.
  jsonRoute(ctx, "GET", ROUTE_LIBRARY, async () => ({
    ok: true,
    alwaysOn: ALWAYS_ON_SKILLS,
    auditSeconds,
    sets: SET_ORDER.map((id) => ({
      id,
      label: SKILL_SETS[id].label,
      hint: SKILL_SETS[id].hint || "",
      skills: SKILL_SETS[id].skills,
      disabled: [...disabledFor(id)],
      denyTools: [...deniedToolsFor(id)],
      preset: presetBySet.get(id) || "",
      on: effectiveSkills(id).length,
      brief: SKILL_SETS[id].brief,
    })),
  }));

  // Preset ids the settings page may bind to a set. Absent service -> an empty list,
  // never an error: binding a preset stays an optional extra.
  jsonRoute(ctx, "GET", ROUTE_PRESETS, async () => {
    try {
      const presets = ctx.get("agentPresets");
      if (!presets?.list) return { ok: false, error: "no-agent-presets", presets: [] };
      const list = await presets.list();
      return {
        ok: true,
        presets: (list || [])
          .map((p) => ({ id: String(p?.id || ""), name: String(p?.name || p?.id || "") }))
          .filter((p) => p.id),
      };
    } catch (error) {
      return { ok: false, error: String((error && error.message) || error).slice(0, 200), presets: [] };
    }
  });

  ready = loadConfig()
    .then(async () => {
      try {
        for (const agent of ctx.get("agents")?.list() ?? []) {
          await install(ctx, agent);
        }
      } catch {
        /* nothing live yet */
      }
    })
    .catch((e) => warn(`config load failed: ${String(e)}`));
}
