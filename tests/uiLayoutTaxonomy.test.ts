import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";

const projectRoot = path.resolve(import.meta.dirname, "..");
const pythonScript = path.join(projectRoot, "backend", "tools", "mlbbUiTaxonomy.py");

function tagNode(name: string, nodePath: string, bundle = "", worldX?: number) {
  const toolsDir = path.join(projectRoot, "backend", "tools");
  const code = `
import json, sys
sys.path.insert(0, ${JSON.stringify(toolsDir)})
from mlbbUiTaxonomy import tag_node
print(json.dumps(tag_node(${JSON.stringify(name)}, ${JSON.stringify(nodePath)}, bundle=${JSON.stringify(bundle)}, world_x=${worldX ?? "None"}, ref_w=1318.0)))
`;
  return JSON.parse(execFileSync("python", ["-c", code], { encoding: "utf8" })) as {
    semanticTags: string[];
    elementKind: string;
    copilotClassHint: string | null;
  };
}

test("asset vocabulary tags pick confirm controls", () => {
  const confirm = tagNode("m_Button_Confirm", "UI_ChooseHeroBP/m_Button_Confirm", "UI_ChooseHeroBP.unity3d");
  assert.ok(confirm.semanticTags.includes("pick_confirm"));
  assert.equal(confirm.elementKind, "button");
});

test("asset vocabulary tags enemy pick turn prompt", () => {
  const enemy = tagNode("m_zlabel_wantpickhero", "root", "UI_ChooseHeroBP.unity3d");
  assert.ok(enemy.semanticTags.includes("waiting_opponent"));
  assert.ok(enemy.semanticTags.includes("enemy_turn"));
});

test("Hero000 on left side maps to ally pick slot", () => {
  const hero = tagNode("Hero000", "m_LEFT/Hero000", "UI_ChooseHeroBP.unity3d", 80);
  assert.ok(hero.semanticTags.includes("ally_pick"));
  assert.equal(hero.copilotClassHint, "ally_pick_slot");
});

test("HUD assets tag health and score elements", () => {
  const hp = tagNode("m_MonsterHPBar", "UI_BattleInfo/m_MonsterHPBar", "UI_BattleInfo.unity3d");
  assert.ok(hp.semanticTags.includes("health_bar"));
  assert.equal(hp.elementKind, "bar");
  const score = tagNode("m_ScoreBar_Blue", "UI_BattleInfo/score", "UI_BattleInfo.unity3d");
  assert.ok(score.semanticTags.includes("score_display"));
});
