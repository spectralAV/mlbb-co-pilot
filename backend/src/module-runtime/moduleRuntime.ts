const modules:any[] = [];
export function sdkDescription(){ return { streams:["draft_state","match_state","map_state","enemy_items","vision_events","tactical_events"], actions:["emit_warning","recommend_item","highlight_zone","create_card"], widgets:["warning_card","hero_card","item_card","map_overlay","stat_panel"], permissions:["read_match_state","read_item_db","read_map_state","emit_warnings"] }; }
export function listModules(){ return modules; }
export function installModule(module:any){ modules.push(module); return module; }
