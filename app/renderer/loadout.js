// The loadout calculator's arithmetic: what a set of fitted components adds up to. Plain script: used by the
// overlay (window.CompanionLoadout) and by the tests (require).
//
// Each component's figures come from the wiki's item pages (scripts/collect-components.js): power and coolant in
// the game's segments, what it draws at least and at most and what a power plant or a cooler generates; a shield's
// HP and regeneration; a gun's damage per shot (alpha), per second while firing (burst) and over 60 s of fire with
// heat or the capacitor in play (sustained); signatures.
(function (root) {
  // The loadout slot types the calculator handles; the item pages name the components' kinds the same way.
  const SLOTS = ['WeaponGun', 'Shield', 'PowerPlant', 'Cooler', 'QuantumDrive', 'Radar', 'LifeSupportGenerator'];
  const sum = (list, f) => list.reduce((a, x) => a + (f(x) || 0), 0);
  // A ship's shield is its two strongest generators at most, whatever it fits: of the 257 ships in the data, every
  // one with more than two shows exactly two generators' HP, and every one with one or two shows their sum. Its
  // regeneration is those two generators' rate shared over all fitted (253 of 255 ships agree).
  const ACTIVE_SHIELDS = 2;

  // parts: [{ slot, comp, control, name }] (comp null when nothing is known of it). Returns the totals and the parts
  // with no figures, so the page can say what is left out.
  function totals(parts) {
    const has = parts.filter((p) => p.comp);
    const guns = has.filter((p) => p.slot === 'WeaponGun' && p.comp.weapon);
    const fittedShields = has.filter((p) => p.slot === 'Shield' && p.comp.shield);
    const shields = [...fittedShields].sort((a, z) => z.comp.shield.hp - a.comp.shield.hp).slice(0, ACTIVE_SHIELDS);
    const plants = has.filter((p) => p.slot === 'PowerPlant');
    const coolers = has.filter((p) => p.slot === 'Cooler');
    const quantum = has.find((p) => p.slot === 'QuantumDrive' && p.comp.quantum);
    // Power plants generate power and coolers coolant; every other component draws between its least and its most.
    const drawing = (gen) => has.filter((p) => p.slot !== gen);
    return {
      alpha: sum(guns, (p) => p.comp.weapon.alpha),
      burst: sum(guns, (p) => p.comp.weapon.burst),
      sustained: sum(guns, (p) => p.comp.weapon.sustained),
      guns: guns.length,
      shieldHp: sum(shields, (p) => p.comp.shield.hp),
      shieldRegen: fittedShields.length ? (sum(shields, (p) => p.comp.shield.regen) * shields.length) / fittedShields.length : 0,
      shieldsActive: shields.length,
      shieldsFitted: fittedShields.length,
      powerGen: sum(plants, (p) => p.comp.genPower),
      powerMin: sum(drawing('PowerPlant'), (p) => p.comp.power?.min),
      powerMax: sum(drawing('PowerPlant'), (p) => p.comp.power?.max),
      coolGen: sum(coolers, (p) => p.comp.genCoolant),
      coolMin: sum(drawing('Cooler'), (p) => p.comp.coolant?.min),
      coolMax: sum(drawing('Cooler'), (p) => p.comp.coolant?.max),
      em: sum(has, (p) => p.comp.em),
      ir: sum(has, (p) => p.comp.ir),
      quantumSpeed: quantum?.comp.quantum.speed || null,
      quantumSpool: quantum?.comp.quantum.spool || null,
      missing: parts.filter((p) => !p.comp).map((p) => p.name),
    };
  }

  // How a budget stands: 'ok' (everything at its most fits), 'tight' (the most passes the generation),
  // or 'over' (more than it makes even with everything at its least).
  const budget = (min, max, gen) => (min > gen ? 'over' : max > gen ? 'tight' : 'ok');

  // The components that can go in a slot: the same kind and size.
  const choices = (slot, size, comps) => comps.filter((c) => c.type === slot && c.size === size);

  const api = { SLOTS, totals, budget, choices };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CompanionLoadout = api;
})(typeof window !== 'undefined' ? window : globalThis);
