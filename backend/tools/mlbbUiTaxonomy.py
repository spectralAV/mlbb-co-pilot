"""
MLBB UI element taxonomy derived from installed-game Unity asset names (NGUI).

Used by extractUnityUILayout.py for semantic tags, draft UI states, element kinds,
and Ultralytics copilot class hints.
"""

from __future__ import annotations

import re
from typing import Any

# Bundle filename → CoPilot screen
BUNDLE_SCREEN_RULES: list[tuple[str, re.Pattern[str]]] = [
    ("draft", re.compile(r"(ChooseHero|ChooseLane|BanList|BPBan|BP_|_BP)", re.I)),
    ("loading", re.compile(r"(BattleLoading|ScenesLoading|GuideLoading|ArenaLoading)", re.I)),
    ("live_hud", re.compile(r"(BattleInfo|HeadInfo|HeadPanel|BattleSetup|BattleMessage|BattleChat|BattlePickup|BattleShop|BattlePlan)", re.I)),
    ("lobby", re.compile(r"(MatchRoom|ChooseMode|Matching|Ranking|RankMode|MatchPunish)", re.I)),
    ("scoreboard", re.compile(r"(BattlePerformance|BattleData|BattleResult|Scoreboard|Statistics|Settlement)", re.I)),
]

# Node name/path tags (asset vocabulary)
SEMANTIC_RULES: list[tuple[str, re.Pattern[str]]] = [
    ("ban_phase", re.compile(r"(banlist|label_ban|sprite_bandone|banhero|m_button_ban|background_ban)", re.I)),
    ("ban_complete", re.compile(r"(bandone\d|ban_done)", re.I)),
    ("ban_lock", re.compile(r"(banhero\d+lock|ban.*lock)", re.I)),
    ("pick_phase", re.compile(r"(titlebg_pick|wantpickhero|heroshow|herocard|m_heromodel)", re.I)),
    ("pick_confirm", re.compile(r"(button_confirm|label_confirm|background_confirm|label_ok\b|label_okay)", re.I)),
    ("pick_end", re.compile(r"(button_end|label_end\b)", re.I)),
    ("waiting_opponent", re.compile(r"(bpsuspend|label_bpsuspend|waiting|wantpickhero)", re.I)),
    ("enemy_turn", re.compile(r"(wantpickhero|tip.*right|_right\b|heromodelright)", re.I)),
    ("ally_turn", re.compile(r"(m_left\b|heromodelleft|tip.*left|_left\b)", re.I)),
    ("lane_select", re.compile(r"(chooselane|lane_intervention|background_changelane|rankroad)", re.I)),
    ("hero_swap", re.compile(r"(herocurrentlyadjust|changeyes|changeno|changetext)", re.I)),
    ("battle_spell", re.compile(r"(skillicon|battlespell|heroskill|sprite_skill)", re.I)),
    ("pick_slot", re.compile(r"(^hero\d{2,3}$|herocard|heroshow)", re.I)),
    ("ban_slot", re.compile(r"(banheroframe|banherobg|banhero0)", re.I)),
    ("health_bar", re.compile(r"(hpbar|hpnum|monsterhp|foreground.*hp)", re.I)),
    ("score_display", re.compile(r"(m_score|scorebar|scoreitem|scramble_score)", re.I)),
    ("match_timer", re.compile(r"(modetime|matchtime|death time|scramblemodetime)", re.I)),
    ("gold_counter", re.compile(r"(label_gold|goldcounter|personal_gold)", re.I)),
    ("kda_display", re.compile(r"(label_death|label_assist|personal_kda|kda)", re.I)),
    ("minimap", re.compile(r"(minimap|smallmap|battlemap)", re.I)),
    ("shop_button", re.compile(r"(button_shop|battleshop|recequip|pickupequip)", re.I)),
    ("loading_screen", re.compile(r"(battleloading|guideloading|label_loading|loadingeffect)", re.I)),
    ("lobby_ready", re.compile(r"(customready|cancelready|getready|rankstart)", re.I)),
    ("chat", re.compile(r"(quickchat|player_chat|m_chat)", re.I)),
]

ELEMENT_KIND_RULES: list[tuple[str, re.Pattern[str]]] = [
    ("button", re.compile(r"(^m_button_|^button_|_button\b)", re.I)),
    ("label", re.compile(r"(^m_label_|^label_|_label\b)", re.I)),
    ("icon", re.compile(r"(skillicon|heroicon|headicon|herohead|skinhead|icon_)", re.I)),
    ("sprite", re.compile(r"(^sprite_|^m_sprite_|^static_sprite)", re.I)),
    ("panel", re.compile(r"(^m_view\b|commonbg|setupbg|_bg\b|background_)", re.I)),
    ("bar", re.compile(r"(hpbar|scorebar|progress|bar\b)", re.I)),
    ("timer", re.compile(r"(timer|time\d|modetime|death time)", re.I)),
    ("score", re.compile(r"(m_score|scoreitem|scorecounter)", re.I)),
]

# Maps to backend/src/vision/cvAnnotation ultralytics class names where applicable
COPILOT_CLASS_RULES: list[tuple[str, re.Pattern[str]]] = [
    ("ally_pick_slot", re.compile(r"(/m_left/|heromodelleft|hero0[0-4]\b)", re.I)),
    ("enemy_pick_slot", re.compile(r"(/m_right/|heromodelright|hero0[5-9]|hero1[0-9]\b)", re.I)),
    ("ally_ban_slot", re.compile(r"(banhero0[1-5]|sprite_banhero|label_ban)", re.I)),
    ("enemy_ban_slot", re.compile(r"(banhero0[6-9]|banhero1[0-9]|_race\b|sprite_banhero)", re.I)),
    ("lane_marker", re.compile(r"(chooselane|lane_intervention|laneicon)", re.I)),
    ("battle_spell_marker", re.compile(r"(skillicon|battlespell|heroskill_icon)", re.I)),
    ("minimap_panel", re.compile(r"(minimap_panel|ui_minimap)", re.I)),
    ("match_timer", re.compile(r"(match_timer|scramblemodetime|modetime)", re.I)),
    ("ally_kill_counter", re.compile(r"(score.*blue|ally_kill|killcounter.*ally)", re.I)),
    ("enemy_kill_counter", re.compile(r"(score.*red|enemy_kill|killcounter.*enemy)", re.I)),
    ("personal_kda", re.compile(r"(label_death|label_assist|personal_kda)", re.I)),
    ("personal_gold_counter", re.compile(r"(label_gold|m_label_gold)", re.I)),
    ("live_hud_stats_region", re.compile(r"(battleinfo|headinfo|headpanel)", re.I)),
    ("equipment_scoreboard", re.compile(r"(recomequip|equipment|equipicon)", re.I)),
]

# Aggregate draft UI states inferred from nodes present in a bundle
DRAFT_STATE_MARKERS: list[tuple[str, re.Pattern[str]]] = [
    ("ban_list_modal", re.compile(r"UI_BanList|m_button_ban", re.I)),
    ("ban_in_progress", re.compile(r"Label_Ban|Sprite_BanHeroFrame|m_Button_Ban", re.I)),
    ("ban_resolved", re.compile(r"Sprite_BanDone", re.I)),
    ("ally_pick_active", re.compile(r"m_LEFT|m_HeroModelLeft|sprite_wantpickhero", re.I)),
    ("enemy_pick_active", re.compile(r"m_RIGHT|m_HeroModelRight|m_zlabel_wantpickhero", re.I)),
    ("pick_confirm_visible", re.compile(r"m_Button_Confirm|Label_Confirm|background_Confirm", re.I)),
    ("pick_locked", re.compile(r"BanHero\d+Lock|pick.*lock", re.I)),
    ("waiting_suspend", re.compile(r"m_BPSuspend|Sprite_BPSuspend", re.I)),
    ("lane_selection", re.compile(r"ChooseLane|Background_ChangeLane", re.I)),
    ("hero_adjust", re.compile(r"HeroCurrentlyAdjust|Label_ChangeYes", re.I)),
]


def _haystack(name: str, path: str, bundle: str = "") -> str:
    return f"{bundle}/{path}/{name}"


def semantic_tags(name: str, path: str, bundle: str = "", world_x: float | None = None, ref_w: float | None = None) -> list[str]:
    text = _haystack(name, path)
    tags = [tag for tag, pattern in SEMANTIC_RULES if pattern.search(text)]
    if bundle and re.search(r"(ChooseHero|BanList)", bundle, re.I):
        tags.append("draft_root")
    if re.match(r"^Hero(\d+)$", name, re.I):
        index = int(re.match(r"^Hero(\d+)$", name, re.I).group(1))
        tags.append("pick_slot")
        if index <= 4:
            tags.append("ally_pick")
        else:
            tags.append("enemy_pick")
    if world_x is not None and ref_w and ref_w > 0:
        ratio = world_x / ref_w
        if ratio < 0.42:
            tags.append("ally_side")
        elif ratio > 0.58:
            tags.append("enemy_side")
    return list(dict.fromkeys(tags))


def element_kind(name: str, path: str) -> str:
    for kind, pattern in ELEMENT_KIND_RULES:
        if pattern.search(name) or pattern.search(path):
            return kind
    if re.match(r"^Hero\d+$", name, re.I):
        return "icon"
    return "node"


def copilot_class_hint(name: str, path: str, tags: list[str], bundle: str = "") -> str | None:
    text = f"{_haystack(name, path)} {' '.join(tags)}"
    for class_name, pattern in COPILOT_CLASS_RULES:
        if pattern.search(text):
            return class_name
    if ("pick_slot" in tags or re.match(r"^Hero\d+$", name, re.I)) and ("ally_pick" in tags or "ally_side" in tags or "ally_turn" in tags):
        return "ally_pick_slot"
    if ("pick_slot" in tags or re.match(r"^Hero\d+$", name, re.I)) and ("enemy_pick" in tags or "enemy_side" in tags or "enemy_turn" in tags):
        return "enemy_pick_slot"
    if "ban_slot" in tags or "ban_phase" in tags:
        if "enemy_side" in tags or "enemy_turn" in tags:
            return "enemy_ban_slot"
        return "ally_ban_slot"
    if "enemy_side" in tags or "enemy_pick" in tags or "enemy_turn" in tags:
        if "ban_slot" in tags or "ban_phase" in tags:
            return "enemy_ban_slot"
        if "pick_slot" in tags:
            return "enemy_pick_slot"
    if "lane_select" in tags:
        return "lane_marker"
    if "battle_spell" in tags:
        return "battle_spell_marker"
    if "health_bar" in tags:
        return "live_hud_stats_region"
    if "score_display" in tags:
        return "score_counter"
    if "match_timer" in tags:
        return "match_timer"
    if "minimap" in tags:
        return "minimap_panel"
    if "loading_screen" in tags:
        return "draft_screen"
    return None


def bundle_screen(bundle_rel: str) -> str:
    for screen, pattern in BUNDLE_SCREEN_RULES:
        if pattern.search(bundle_rel):
            return screen
    return "other"


def draft_ui_states(node_names: list[str], bundle_rel: str) -> list[str]:
    text = f"{bundle_rel} {' '.join(node_names)}"
    states = [state for state, pattern in DRAFT_STATE_MARKERS if pattern.search(text)]
    screen = bundle_screen(bundle_rel)
    if screen == "draft" and "draft_root" not in states:
        states.insert(0, "draft_screen")
    return list(dict.fromkeys(states))


def tag_node(
    name: str,
    path: str,
    *,
    bundle: str = "",
    world_x: float | None = None,
    ref_w: float | None = None,
) -> dict[str, Any]:
    tags = semantic_tags(name, path, bundle, world_x, ref_w)
    return {
        "semanticTags": tags,
        "elementKind": element_kind(name, path),
        "copilotClassHint": copilot_class_hint(name, path, tags, bundle),
    }
