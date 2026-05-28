import { useState, useMemo } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// DATA
// ─────────────────────────────────────────────────────────────────────────────

const LEVEL_TABLE = [
  { level: 4, xp: 0,   bp: 9,  lp: 3, spikes: 2 },
  { level: 5, xp: 10,  bp: 11, lp: 3, spikes: 2 },
  { level: 6, xp: 21,  bp: 13, lp: 4, spikes: 2 },
  { level: 7, xp: 33,  bp: 15, lp: 4, spikes: 3 },
  { level: 8, xp: 46,  bp: 17, lp: 4, spikes: 3 },
  { level: 9, xp: 60,  bp: 19, lp: 4, spikes: 3 },
  { level: 10, xp: 75, bp: 21, lp: 4, spikes: 3 },
];

// ALL PURCHASABLE SKILLS (name, cost, ranks, prereqs, category, desc)
const ALL_SKILLS = [
  // MARTIAL
  { name: "Basic Martial Weapons", cost: 1, cat: "Martial", prereq: null, desc: "Hand weapons (16–22\") and staves. Foundation of all weapon skills." },
  { name: "Short Weapons", cost: 3, cat: "Martial", prereq: "Basic Martial Weapons", desc: "Short weapons 22–36\"." },
  { name: "Long Weapons", cost: 7, cat: "Martial", prereq: "Short Weapons", desc: "Long weapons 36–48\"." },
  { name: "Great Weapons", cost: 5, cat: "Martial", prereq: "Basic Martial Weapons", desc: "Great weapons 48–90\". Spike: +1 damage or Quick Disable Leg." },
  { name: "Projectile Weapons", cost: 3, cat: "Martial", prereq: "Basic Martial Weapons", desc: "Bows and crossbows. Aim (Quick 10) for spike damage without expending." },
  { name: "Thrown Weapons", cost: 3, cat: "Martial", prereq: "Basic Martial Weapons", desc: "Thrown weapons proficiency." },
  { name: "Basic Shields", cost: 4, cat: "Martial", prereq: null, desc: "Bucklers (38\" perim max) and small shields (63\" perim max)." },
  { name: "Advanced Shields", cost: 2, cat: "Martial", prereq: "Basic Shields", desc: "Medium (94\" perim) and large shields (106\" perim)." },
  { name: "Great Shields", cost: 2, cat: "Martial", prereq: "Advanced Shields", desc: "Great shields (125\" perim max)." },
  { name: "Shield Expertise", cost: 5, cat: "Martial", prereq: "Basic Shields", desc: "Counter one weapon attack that hits your shield per Short Rest." },
  { name: "Basic Armor", cost: 2, cat: "Martial", prereq: null, desc: "Benefit from up to 2 AP of repped armor." },
  { name: "Light Armor", cost: 3, cat: "Martial", prereq: "Basic Armor", desc: "Benefit from up to 4 AP of repped armor." },
  { name: "Medium Armor", cost: 4, cat: "Martial", prereq: "Light Armor", desc: "Benefit from up to 6 AP of repped armor." },
  { name: "Heavy Armor", cost: 3, cat: "Martial", prereq: "Medium Armor", desc: "Benefit from up to 8 AP of repped armor." },
  { name: "Ironclad Armor", cost: 2, cat: "Martial", prereq: "Heavy Armor", desc: "Benefit from up to 11 AP of repped armor." },
  { name: "Armor Expertise", cost: 6, cat: "Martial", prereq: "Basic Armor", desc: "+1 Physical Base Max Armor Points while wearing any physical armor." },
  { name: "Two Weapon Style", cost: 2, cat: "Martial", prereq: "Short Weapons", desc: "Wield two weapons. Only one can be over 36\"; neither over 48\"." },
  { name: "Advanced Two Weapon Style", cost: 2, cat: "Martial", prereq: "Two Weapon Style", desc: "Both weapons can be up to 48\" long." },
  { name: "Advanced Great Weapon Style", cost: 1, cat: "Martial", prereq: "Great Weapons", desc: "Hold a second weapon in great weapon hand; block with great weapon one-handed." },
  { name: "Weapon Specialization", cost: 4, cat: "Martial", prereq: "Basic Martial Weapons", desc: "Choose one weapon type. +1 Spike after each Short Rest usable only with that weapon." },
  { name: "Axecraft", cost: 4, cat: "Martial", prereq: "Short Weapons, Weapon Specialization (Axes), 2 Martial levels", desc: "Spend Spike to call Wounding with axe; Shatter shields with great axe." },
  { name: "Hooked Head", cost: 4, cat: "Martial", prereq: "Axecraft, 5 Martial levels", desc: "Spend Spike to Disarm a weapon or shield struck by your axe." },
  { name: "Chopper", cost: 4, cat: "Martial", prereq: "Hooked Head, 10 Martial levels", desc: "+1 Base Damage when spending a Spike with axe (Force accent)." },
  { name: "Bowcraft", cost: 4, cat: "Martial", prereq: "Projectile Weapons, Weapon Specialization (Projectile), 2 Martial levels", desc: "Spend Spike to Shatter a shield when you hit it with a bow." },
  { name: "Quick Shot", cost: 4, cat: "Martial", prereq: "Bowcraft, 5 Martial levels", desc: "Do Spike damage with bow without aim time, up to Max Spikes per Short Rest." },
  { name: "Bowmaster", cost: 4, cat: "Martial", prereq: "Quick Shot, 10 Martial levels", desc: "Aim (Quick 10): +1 damage or Disable a limb (Spike)." },
  { name: "Daggercraft", cost: 4, cat: "Martial", prereq: "Weapon Specialization (Daggers), 2 Martial levels", desc: "+1 Base Max Spikes while using only daggers." },
  { name: "Parrying Dagger", cost: 4, cat: "Martial", prereq: "Daggercraft, 5 Martial levels", desc: "Counter any melee attack once per Short Rest while using only daggers." },
  { name: "Flurry of Cuts", cost: 4, cat: "Martial", prereq: "Parrying Dagger, 10 Martial levels", desc: "Spend Spike: 'Piercing 1 by Force' with daggers. Counter refunds a Spike." },
  { name: "Macecraft", cost: 4, cat: "Martial", prereq: "Short Weapons, Weapon Specialization (Maces), 2 Martial levels", desc: "Spend Spike to add Wounding when mace is blocked by a shield." },
  { name: "Toppling Blows", cost: 4, cat: "Martial", prereq: "Macecraft, 5 Martial levels", desc: "Spend Spike to Slow with mace." },
  { name: "Denting Blow", cost: 4, cat: "Martial", prereq: "Toppling Blows, 10 Martial levels", desc: "Spend Spike to Shatter Armor with mace." },
  { name: "Polearmcraft", cost: 4, cat: "Martial", prereq: "Great Weapons, Weapon Specialization (Polearms/Swords/Axes/Maces), 2 Martial levels", desc: "Spend Spike to Counter a Disarm with polearm." },
  { name: "Sweeping Strike", cost: 4, cat: "Martial", prereq: "Polearmcraft, 5 Martial levels", desc: "Attempt an attack on an adjacent target with polearm." },
  { name: "Holding Back the Tide", cost: 4, cat: "Martial", prereq: "Sweeping Strike, 10 Martial levels", desc: "Spend Spike to Repel with polearm." },
  { name: "Thrown Weaponcraft", cost: 4, cat: "Martial", prereq: "Thrown Weapons, Weapon Specialization (Thrown), 2 Martial levels", desc: "Spend Spike to Repel with thrown weapons." },
  { name: "Shattering Toss", cost: 4, cat: "Martial", prereq: "Thrown Weaponcraft, 5 Martial levels", desc: "Spend Spike to Shatter items with thrown weapons." },
  { name: "Jester's Lethality", cost: 4, cat: "Martial", prereq: "Shattering Toss, 10 Martial levels", desc: "Aim for +1 damage with thrown weapons." },
  { name: "Weapon Mastery", cost: 6, cat: "Martial", prereq: "Basic Martial Weapons, Weapon Specialization (any), 10 Martial levels", desc: "+1 to base Spike damage." },
  { name: "Bladechannel", cost: 3, cat: "Martial", prereq: "Weapon Specialization (any), one Adept spell-slot", desc: "Convert Packet or Verbal spell delivery to Weapon delivery." },
  { name: "Extensive Combat Training - Basic", cost: 4, ranks: 2, cat: "Martial", prereq: "One level in a non-casting class", desc: "Choose one additional Basic Power from your class." },
  { name: "Extensive Combat Training - Advanced", cost: 5, ranks: 2, cat: "Martial", prereq: "One level in a non-casting class", desc: "Choose one additional Advanced Power from your class." },
  { name: "Extensive Combat Training - Veteran", cost: 6, ranks: 1, cat: "Martial", prereq: "One level in a non-casting class", desc: "Choose one additional Veteran Power from your class." },
  { name: "Extensive Training", cost: 6, cat: "Martial", prereq: "One level in a non-casting class", desc: "Choose one additional Utility Power from your class." },
  { name: "Agile Learner", cost: 3, ranks: 3, cat: "Martial", prereq: "6th character level, levels in at least two Base Classes", desc: "Trade a lower-tier power for a higher one." },
  // MAGIC
  { name: "Basic Arcane", cost: 4, cat: "Magic", prereq: null, desc: "Gain a Known Arcane Spell and a Spellbook. First step in casting Arcane spells." },
  { name: "Basic Faith", cost: 4, cat: "Magic", prereq: null, desc: "Gain a Known Divine Spell. First step in casting Divine spells." },
  { name: "Worship", cost: 1, cat: "Magic", prereq: null, desc: "Access up to 2 Divine Domains from your Devotion." },
  { name: "Divine Favor", cost: 2, ranks: null, cat: "Magic", prereq: "Worship", desc: "Alter Accent of a Spike or Power to Divine." },
  { name: "Divine Focus", cost: 2, cat: "Magic", prereq: "Worship", desc: "Substitute your Devotion's specific Accent instead of generic Divine." },
  { name: "Concurrent Meditation", cost: 3, cat: "Magic", prereq: "One Novice Arcane Slot, one Novice Divine Slot", desc: "Use Short Rest spell-slot refresh powers from different Spheres concurrently." },
  { name: "Extended Capacity - Novice", cost: 3, ranks: 4, cat: "Magic", prereq: "One level in a spell-casting class", desc: "+1 Novice spell-slot." },
  { name: "Extended Capacity - Adept", cost: 4, ranks: 4, cat: "Magic", prereq: "One Adept spell-slot, one level in a spell-casting class", desc: "+1 Adept spell-slot." },
  { name: "Extended Capacity - Greater", cost: 6, ranks: 3, cat: "Magic", prereq: "One Greater spell-slot, one level in a spell-casting class", desc: "+1 Greater spell-slot." },
  { name: "Additional Cantrip", cost: 6, cat: "Magic", prereq: "Basic Arcane or Basic Faith", desc: "Choose one additional Cantrip from your class." },
  { name: "Advanced Recharge", cost: 2, ranks: 4, cat: "Magic", prereq: "Basic Arcane or Basic Faith", desc: "Add 1 temporary spell-slot of any Tier instead of 3 Novice when using Refresh." },
  { name: "Spell-Scholar", cost: 4, ranks: 12, cat: "Magic", prereq: "Basic Arcane or Basic Faith", desc: "+1 to Known Spells." },
  { name: "Bookcaster", cost: 1, ranks: null, cat: "Magic", prereq: "Basic Arcane or Basic Faith", desc: "Cast a spell straight from your spellbook without it being a Known Spell." },
  { name: "Bookcasting Expertise", cost: 3, ranks: 4, cat: "Magic", prereq: "Bookcaster, 6 levels in one spell-casting class", desc: "Bookcast one spell per Long Rest without expending a spell-slot." },
  { name: "Peacecaster", cost: 3, cat: "Magic", prereq: "One Novice spell-slot", desc: "+1 Healing to Healing Spells (not Cantrips); first charge only." },
  { name: "Advanced Peacecasting", cost: 5, cat: "Magic", prereq: "Peacecaster, one Greater spell-slot", desc: "+1 Healing to Healing Cantrips (not Spells); first charge only." },
  { name: "Warcaster", cost: 5, cat: "Magic", prereq: "One Novice spell-slot", desc: "+1 Damage to damaging weapon/packet spells (not Cantrips)." },
  { name: "Advanced Warcasting", cost: 5, cat: "Magic", prereq: "Warcaster, one Greater spell-slot", desc: "+1 Damage to all damaging Cantrips." },
  { name: "Spell Storing", cost: 3, cat: "Magic", prereq: "Basic Faith or Arcane, 10 levels in a casting class", desc: "Soulhold a spell-packet for later use." },
  { name: "Ritual Crafting", cost: 3, cat: "Magic", prereq: "Journeyman Ritual Magic", desc: "Can propose new rituals to the plot team." },
  // SCHOLAR
  { name: "Lore", cost: 2, ranks: null, cat: "Scholar", prereq: null, desc: "Knowledge of a particular area of study. Choose a topic each time purchased." },
  { name: "Library Use", cost: 1, cat: "Scholar", prereq: null, desc: "Expertise in library use. Can research subjects while NPCing." },
  { name: "Research", cost: 4, cat: "Scholar", prereq: "Lore (any)", desc: "Can research a topic once per event." },
  // MEDICAL
  { name: "Basic Medicine", cost: 2, cat: "Medical", prereq: null, desc: "Discern Dying/Dead status. Stabilize the dying." },
  { name: "Diagnose", cost: 1, cat: "Medical", prereq: "Basic Medicine", desc: "Discern exact damage total and current Conditions." },
  { name: "Advanced Medicine", cost: 4, cat: "Medical", prereq: "Basic Medicine", desc: "Cure Disabled, Poisoned, Weakened, and Slept conditions." },
  { name: "Combat Medic", cost: 1, cat: "Medical", prereq: "Basic Medicine, Diagnose", desc: "Fast Stabilize (Quick 10), fast carry (no count)." },
  // TRADE
  { name: "Chronic Hobbyist", cost: 2, ranks: 3, cat: "Trade", prereq: "Profession - Apprentice (any)", desc: "Knowledge of a chosen Profession. One Discern ability." },
  { name: "Profession - Apprentice", cost: 1, cat: "Trade", prereq: null, desc: "Basic knowledge of a chosen profession. +3 Wealth per game." },
  { name: "Profession - Journeyman", cost: 2, cat: "Trade", prereq: "Profession - Apprentice", desc: "Intermediate knowledge. +5 Wealth per game. One Discern ability." },
  { name: "Profession - Master", cost: 3, cat: "Trade", prereq: "Profession - Journeyman", desc: "Expert knowledge. +8 Wealth per game. Additional Discern ability." },
  { name: "Tracking", cost: 4, cat: "Trade", prereq: null, desc: "Can follow tracking flags placed by staff." },
  { name: "Hustle", cost: 4, cat: "Trade", prereq: null, desc: "Take one background action per event." },
  // THIEVING
  { name: "Basic Locks", cost: 5, cat: "Thieving", prereq: null, desc: "Pick mundane locks with lockpicks." },
  { name: "Basic Traps", cost: 5, cat: "Thieving", prereq: null, desc: "Disarm traps." },
  { name: "Advanced Traps", cost: 4, cat: "Thieving", prereq: "Basic Traps", desc: "Set traps." },
  { name: "Fence", cost: 3, cat: "Thieving", prereq: null, desc: "Sell items for Wealth above face value." },
  { name: "Poisoner", cost: 1, cat: "Thieving", prereq: null, desc: "Safely apply poisons to weapons and drinks." },
  // GATHERING
  { name: "Forage I", cost: 3, cat: "Gathering", prereq: null, desc: "Forage Bloom and Night Prizes from the Wilderness." },
  { name: "Forage II", cost: 3, cat: "Gathering", prereq: "Forage I", desc: "Forage more Bloom and Night Prizes." },
  { name: "Forage III", cost: 3, cat: "Gathering", prereq: "Forage II, Character Level 10", desc: "Forage more rewards including Golden Blossom Seed." },
  { name: "Scavenge I", cost: 3, cat: "Gathering", prereq: null, desc: "Scavenge creatures after combat for resources." },
  { name: "Scavenge II", cost: 3, cat: "Gathering", prereq: "Scavenge I", desc: "Scavenge with more rewards." },
  { name: "Scavenge III", cost: 3, cat: "Gathering", prereq: "Scavenge II, Character Level 10", desc: "Scavenge with even more rewards; possibly Raw Scale." },
  { name: "Prospect I", cost: 3, cat: "Gathering", prereq: null, desc: "Mine once per Long Rest at each Mine or Mineral deposit." },
  { name: "Prospect II", cost: 3, cat: "Gathering", prereq: "Prospect I", desc: "Mine with more rewards." },
  { name: "Prospect III", cost: 3, cat: "Gathering", prereq: "Prospect II, Character Level 10", desc: "Mine with even more rewards; possibly Mithril Ore." },
  // CRAFTING
  { name: "Apprentice Alchemy", cost: 3, cat: "Crafting", prereq: null, desc: "Create Apprentice Alchemy recipes and safely apply poisons." },
  { name: "Journeyman Alchemy", cost: 4, cat: "Crafting", prereq: "Apprentice Alchemy, 4th level character", desc: "Create Journeyman Alchemy recipes." },
  { name: "Greater Alchemy", cost: 5, cat: "Crafting", prereq: "Journeyman Alchemy, 10th level character", desc: "Create Greater Alchemy recipes." },
  { name: "Apprentice Tinkering", cost: 3, cat: "Crafting", prereq: null, desc: "Create Apprentice Tinkering schematics." },
  { name: "Journeyman Tinkering", cost: 4, cat: "Crafting", prereq: "Apprentice Tinkering, 4th level character", desc: "Create Journeyman Tinkering schematics." },
  { name: "Greater Tinkering", cost: 5, cat: "Crafting", prereq: "Journeyman Tinkering, 10th level character", desc: "Create Greater Tinkering schematics." },
  { name: "Apprentice Enchanting", cost: 3, cat: "Crafting", prereq: null, desc: "Create Apprentice Enchanting formulae." },
  { name: "Journeyman Enchanting", cost: 4, cat: "Crafting", prereq: "Apprentice Enchanting, 4th level character", desc: "Create Journeyman Enchanting formulae." },
  { name: "Greater Enchanting", cost: 5, cat: "Crafting", prereq: "Journeyman Enchanting, 10th level character", desc: "Create Greater Enchanting formulae." },
  { name: "Apprentice Ritual Magic", cost: 1, cat: "Crafting", prereq: null, desc: "Participate in and perform Apprentice Rituals." },
  { name: "Journeyman Ritual Magic", cost: 2, cat: "Crafting", prereq: "Apprentice Ritual Magic, 4th level character", desc: "Perform Journeyman Rituals." },
  { name: "Greater Ritual Magic", cost: 3, cat: "Crafting", prereq: "Journeyman Ritual Magic, 10th level character", desc: "Perform Greater Rituals." },
  { name: "Ritual Lore", cost: 2, cat: "Crafting", prereq: null, desc: "Knowledge of ritual magic theory. Required alongside Ritual Magic skills." },
  { name: "Mastercrafter", cost: 4, cat: "Crafting", prereq: "Greater rank of one Crafting Skill and Profession - Apprentice", desc: "Submit 1 item per event for exceptional crafted boons." },
];

// ALL PERKS
const ALL_PERKS = [
  // Mystical
  { name: "Generous Soul", cost: 5, cat: "Mystical", prereq: null, desc: "Once per Long Rest, Revive by Divine — but you take damage." },
  { name: "Greedy Soul", cost: 3, cat: "Mystical", prereq: null, desc: "Attune four magic items instead of three." },
  { name: "Magical Resilience", cost: 6, cat: "Mystical", prereq: null, desc: "After Short Rest, gain Counter vs. Packets." },
  { name: "Mystic Armorer", cost: 3, ranks: 3, cat: "Mystical", prereq: "Basic Arcane, Basic Faith, or Apprentice Enchanting", desc: "Mend Physical Armor to full in a Q100." },
  { name: "Mystic Smith", cost: 5, cat: "Mystical", prereq: "Mystic Armorer", desc: "Mend 2 points of another character's armor." },
  { name: "Master Mystic Smith", cost: 3, cat: "Mystical", prereq: "Mystic Smith", desc: "+1 to armor Mending when using Mystic Smith." },
  { name: "Soothing Touch", cost: 1, cat: "Mystical", prereq: null, desc: "At will, Cure Fear on a Quick 100." },
  // Physical
  { name: "Agility", cost: 2, cat: "Physical", prereq: null, desc: "Advantage on physical feats of agility." },
  { name: "Bloody Minded", cost: 3, cat: "Physical", prereq: null, desc: "Resist Charm effects equal to character level per Long Rest." },
  { name: "Carnal Creature", cost: 1, cat: "Physical", prereq: null, desc: "Delay Spirit Form until Slow 300 after death (instead of immediate)." },
  { name: "Cold Dead Hands", cost: 3, cat: "Physical", prereq: null, desc: "Weapons cannot be taken from you while Slept, Dying, or Dead." },
  { name: "Deathgrip", cost: 1, cat: "Physical", prereq: null, desc: "While Dying, can crawl and continue to hold objects." },
  { name: "Elemental Affinity", cost: 4, ranks: 2, cat: "Physical", prereq: null, desc: "Attune to one element. Resistance to that element; Final to the opposite." },
  { name: "Hard to Kill", cost: 1, cat: "Physical", prereq: null, desc: "Slow 300 (instead of 180) while Dying." },
  { name: "Holding On", cost: 1, cat: "Physical", prereq: null, desc: "After a Deathblow, takes 30 seconds to die rather than instantly." },
  { name: "Iron Stomach", cost: 2, cat: "Physical", prereq: null, desc: "Once per Long Rest, Counter an ingested Poison." },
  { name: "Quick Healing", cost: 3, cat: "Physical", prereq: null, desc: "Heals 1 Life Point after each Short Rest." },
  { name: "Toughness", cost: 5, cat: "Physical", prereq: null, desc: "+1 to maximum Life Points." },
  { name: "Unkillable", cost: 4, cat: "Physical", prereq: "Holding On", desc: "Once per Long Rest, stabilize at 0 LP instead of entering Dying." },
  { name: "Will to Live", cost: 1, cat: "Physical", prereq: null, desc: "Convert one Death Effect to Final Damage once per Event." },
  // Patron
  { name: "Patron", cost: 4, cat: "Patron", prereq: null, desc: "Gain a personal divine patron (separate from your Devotion)." },
  { name: "Gift of Hateful Retribution", cost: 2, cat: "Patron", prereq: "Patron", desc: "Causes damage to those that attempt to Deathblow or kill you." },
  { name: "Gift of Healing", cost: 2, ranks: null, cat: "Patron", prereq: "Patron", desc: "Focus Q100 to heal yourself or another to full LP." },
  { name: "Gift of Rebirth", cost: 3, cat: "Patron", prereq: "Patron", desc: "Once ever instead of dissipating, self-only Revive." },
  { name: "Gift of Recognition", cost: 1, cat: "Patron", prereq: "Patron", desc: "Sense who else is sworn to your same Patron." },
  { name: "Gift of Unbreakable Flesh", cost: 4, cat: "Patron", prereq: "Patron", desc: "Gain Natural Armor from your Patron's blessing." },
  { name: "Ultimate Gift", cost: 1, cat: "Patron", prereq: "Patron", desc: "Go to the River to Revive and Heal others." },
  // Social / Background
  { name: "Ancestral Relic", cost: 2, cat: "Social", prereq: null, desc: "Choose one important item that won't be dropped involuntarily." },
  { name: "Ancestral Weapon", cost: 4, cat: "Social", prereq: "Ancestral Relic", desc: "Your chosen weapon cannot be taken from you." },
  { name: "Bits and Pieces", cost: 1, cat: "Social", prereq: null, desc: "Once per Long Rest, act as if you had a rank of Lore." },
  { name: "Boon Bonds", cost: 2, cat: "Social", prereq: null, desc: "Choose a group: diagnose, heal, and Cure Effects on them once per Long Rest." },
  { name: "Contact", cost: 2, cat: "Social", prereq: null, desc: "Get Lore from an off-stage contact during games for a cost." },
  { name: "Connections", cost: 2, cat: "Social", prereq: null, desc: "Call on powerful allies for assistance." },
  { name: "Draconic Heritage", cost: 2, cat: "Social", prereq: null, desc: "Dragon ancestors grant advantages that scale with character level." },
  { name: "Famous", cost: 3, cat: "Social", prereq: "Minor Fame", desc: "Known for famous deeds across the land." },
  { name: "Heartbond", cost: 3, cat: "Social", prereq: null, desc: "Gain Perks tied to a single creature bound by love." },
  { name: "Income", cost: 3, cat: "Social", prereq: null, desc: "+10 Wealth at the beginning of every game." },
  { name: "Inheritance", cost: 4, cat: "Social", prereq: null, desc: "One-time sum of 100 Wealth at character creation." },
  { name: "Manse", cost: 3, cat: "Social", prereq: null, desc: "Own a house; draw funds from goods produced once per Event." },
  { name: "Minor Fame", cost: 1, cat: "Social", prereq: null, desc: "Known for one famous deed in your past." },
  { name: "Sharp Mind", cost: 3, cat: "Social", prereq: null, desc: "Library Use is free; Lore ranks cost 1 BP less." },
  { name: "Strong Bloodline", cost: 3, cat: "Social", prereq: null, desc: "+3 LBP for Lineage Advantages." },
  { name: "Title", cost: 4, cat: "Social", prereq: null, desc: "Gain a title and associated mechanical benefits." },
  // Supernatural
  { name: "Fortunate Finder", cost: 3, ranks: 2, cat: "Supernatural", prereq: null, desc: "Once per Long Rest per purchase, ignore a negative gathering effect." },
  { name: "Insight", cost: 3, ranks: 2, cat: "Supernatural", prereq: null, desc: "Once per Long Rest per purchase, ask for help on a riddle or puzzle." },
  { name: "Medium", cost: 5, cat: "Supernatural", prereq: null, desc: "Some ability to summon and speak with Spirits." },
  { name: "Othersleep", cost: 1, cat: "Supernatural", prereq: null, desc: "Disappear when asleep; cannot be attacked during sleep." },
  { name: "Sight", cost: 3, cat: "Supernatural", prereq: null, desc: "See objects that are normally invisible." },
  { name: "Sight Beyond Sight", cost: 3, cat: "Supernatural", prereq: "Sight", desc: "Gain insight on normally invisible objects." },
  { name: "Sensitive", cost: 3, cat: "Supernatural", prereq: "Sight Beyond Sight", desc: "Gain insights normally impossible to perceive." },
  { name: "Soothsayer", cost: 3, cat: "Supernatural", prereq: null, desc: "Perform a ceremony to ask plot one question." },
  { name: "Strong Spirit", cost: 3, cat: "Supernatural", prereq: null, desc: "While in Spirit Form, options to interact with the mortal world." },
  // Hearth
  { name: "Hearth", cost: 1, cat: "Hearth", prereq: null, desc: "Create a special room that enables Hearth Perks and bonuses." },
  { name: "Arcane Hearth", cost: 2, cat: "Hearth", prereq: "Hearth", desc: "Arcane Hearth reduces ritual Dark Territory by 1 for members." },
  { name: "Consecrated Hearth", cost: 2, cat: "Hearth", prereq: "Hearth", desc: "Add a prayer shrine; reduces ritual Dark Territory by 1 for Devotion members." },
  { name: "Experimental Hearth", cost: 3, cat: "Hearth", prereq: "Arcane Hearth", desc: "Crystal focus reduces ritual Dark Territory by 1 for members." },
];

const ALL_FLAWS = [
  { name: "Honor Debt", bp: 2, cat: "Personal", desc: "Has a debt that must be repaid. (1–2 BP based on severity)" },
  { name: "Indoor Discomfort", bp: 1, cat: "Personal", desc: "-1 Spike and Power damage while inside structures." },
  { name: "Nightmares", bp: 3, cat: "Personal", desc: "Penalties after in-game events trigger nightmares." },
  { name: "Pliant", bp: 2, cat: "Personal", desc: "Vulnerability to Charm effects." },
  { name: "Outdoor Discomfort", bp: 3, cat: "Personal", desc: "-1 Spike and Power damage while outdoors." },
  { name: "Fragile Bones", bp: 3, cat: "Physical", desc: "Force Accent effects are treated as Final." },
  { name: "Dies Alone", bp: 2, cat: "Physical", desc: "Unconscious and cannot call out while Dying." },
  { name: "Divine Vulnerability", bp: 3, cat: "Physical", desc: "Divine Accent effects are treated as Final." },
  { name: "Mild Allergy", bp: 1, cat: "Physical", desc: "Allergy to gold, silver, iron, or magic. Cannot rest/heal efficiently in contact." },
  { name: "Severe Allergy", bp: 3, cat: "Physical", desc: "Severe allergy — pain and Drained while in contact." },
  { name: "Shunned Soul", bp: 1, cat: "Spiritual", desc: "Cannot benefit from Short Rests on Consecrated Ground." },
  { name: "Disquieting Aura", bp: 1, cat: "Spiritual", desc: "Cannot Cure Berserk, Charmed, or Repelled." },
  { name: "Torn Soul", bp: 4, cat: "Spiritual", desc: "Only ever heals 1 LP from any healing source." },
  { name: "Truthbound", bp: 2, cat: "Spiritual", desc: "Cannot lie. Takes Final Damage if they speak a lie." },
  { name: "Binding Oath of Charity", bp: 5, cat: "Oath", desc: "Cannot keep goods beyond survival. Must protect the poor and oppressed." },
  { name: "Binding Oath of Chastity", bp: 1, cat: "Oath", desc: "No sexual or romantic relationships." },
  { name: "Binding Oath of Civility", bp: 2, cat: "Oath", desc: "Must treat others with respect and civility at all times." },
  { name: "Binding Oath of Honor", bp: 2, cat: "Oath", desc: "Must be fair, cannot cheat, must be honorable." },
  { name: "Binding Oath of Peace", bp: 5, cat: "Oath", desc: "Cannot end life. Only fight in self-defense. Must prevent others from being killed." },
];

const CLASSES = {
  Artisan: { type: "Martial", role: "Support/Crafting", spellcaster: false, description: "Master crafter. Three specializations: Artificer (combat+armor repair), Crafter (superior items), Mystic (ritual magic). Living Iron pool mends armor in combat.", startingSkills: ["Basic Martial Weapons (1)", "Short Weapons (3)", "Basic Armor (2)", "Apprentice Crafting: Alchemy/(Ritual Magic+Lore)/Enchanting/Tinkering (3)", "Gathering skill: Forage I, Prospect I, or Scavenge I (3)", "Choose: Profession, 2nd Crafting skill, or Basic Medicine bundle"], multiclassSkills: "Basic Martial Weapons, one Gathering skill", keyFeatures: ["Living Iron: armor mending pool (3×level per Long Rest)", "Specialization bonuses (Artificer/Crafter/Mystic)", "Brilliant Thinker: +1 Basic Power at level 3", "Grand Ritualist: modify Dark Territory at level 7"] },
  Cleric: { type: "Divine Spellcaster", role: "Healer/Support", spellcaster: true, magicType: "Divine", description: "Healing and support through divine magic. Must choose a Devotion. Refreshing Prayer restores spell slots via prayer. Strongest healer in the game.", startingSkills: ["Basic Faith (4)", "Worship (1)", "Basic Martial Weapons (1)", "Basic Armor (2)", "Choose: Short Weapons (3) OR Extended Capacity-Novice (3) OR Basic Medicine+Diagnose (3)", "Choose: Extended Capacity-Novice ×2 OR Additional Cantrip OR Bookcaster×3+Peacecaster OR Basic+Advanced Shields"], multiclassSkills: "Basic Faith, Worship", keyFeatures: ["Refreshing Prayer: regain spell slots via prayer at level 1", "Healing Touch at level 2", "Shield of Faith at level 5", "Prayer at Consecrated Ground grants +3 bonus Novice slots"], note: "Must choose a Devotion. Required for full class functionality." },
  Druid: { type: "Divine Spellcaster", role: "Melee/Nature Magic", spellcaster: true, magicType: "Divine", description: "Nature-bonded melee/caster hybrid with unique combat Forms. Transform into Hulking Bear, Striking Serpent, or Hunting Panther.", startingSkills: ["Basic Martial Weapons (1)", "Profession-Apprentice (1)", "Forage I or Scavenge I (3)", "Basic Faith (4)", "Choose: Extended Capacity-Novice+Lore:Nature (5) OR Short Weapons+Two-Weapon Style (5) OR Peacecaster+Basic Medicine (5)"], multiclassSkills: "Basic Faith", keyFeatures: ["Commune with Nature at level 1", "Three combat Forms (Bear/Serpent/Panther)", "Earth's Vitality at level 5", "Attacking from behind triggers bonus effects"] },
  Fighter: { type: "Martial", role: "Front-line Melee", spellcaster: false, description: "Versatile front-line warrior. Broadest martial class. Deadly Remnants lets them use shattered weapons. Multiple weapon path options.", startingSkills: ["Basic Martial Weapons (1)", "Basic Shields (4)", "Basic Armor (2)", "Light Armor (3)", "Choose: Projectile Weapons+Lore:Historical (5) OR Short Weapons+[Advanced Shields or Two-Weapon Style] (5) OR Great Weapons (5)"], multiclassSkills: "Basic Martial Weapons, Short Weapons", keyFeatures: ["Deadly Remnants: use shattered weapons at level 1", "Parry Blow: Counter weapon attack per Short Rest at level 3", "Fighting Instructor: teach weapon skills at level 4", "+1 AP while wearing any physical armor at level 4"] },
  Mage: { type: "Arcane Spellcaster", role: "Control/Utility", spellcaster: true, magicType: "Arcane", description: "Controlled arcane mastery. Potent offense AND defense. Relies on Barrier and Protects instead of armor. Back-line powerhouse.", startingSkills: ["Basic Arcane (4)", "Choose a Lore (2)", "Library Use (1)", "Bookcaster ×2 (2)", "Choose: Extended Capacity-Novice×2 (6) OR Advanced Recharge+Lore:Arcane+Bookcaster×2 (6) OR Bookcaster×6 (6) OR Additional Cantrip (6)"], multiclassSkills: "Basic Arcane", keyFeatures: ["Cancel cantrip free at level 1", "Replicate Enhancement: bonus on Touch spells at level 2", "Arcane Barrier at level 5", "Cantrip Mastery at level 8"], note: "Cannot effectively use armor. Needs Spellbook and caster-sigil." },
  Rogue: { type: "Martial", role: "Striker/Skullduggery", spellcaster: false, description: "Agile striker. Backstab bonus, thrown weapon mastery, and access to locks/traps/poisons. Deflects projectiles innately.", startingSkills: ["Basic Martial Weapons (1)", "Thrown Weapons (3)", "Basic Armor (2)", "Light Armor (3)", "Choose: Short Weapons+Scavenge (6) OR Fence+Lore:Shadow+Profession (6) OR Basic Locks or Traps+Poisoner (6) OR Connections+Lore:Shadow+Contact (6)"], multiclassSkills: "Basic Martial Weapons, Thrown Weapons", keyFeatures: ["Deflect Projectiles innate at level 1", "Backstab (+1 Base Damage from behind) at level 2", "+1 Base Max Spikes at level 3", "Dodge and Backstab +2 at level 5"] },
  Socialite: { type: "Martial (Social)", role: "Social/Information", spellcaster: false, description: "Master of information and social combat. Discerns facts, controls enemies with words, empowers a Bodyguard. Information is currency.", startingSkills: ["Basic Martial Weapons (1)", "Library Use (1)", "Poisoner (1)", "Basic Armor (2)", "Choose a Lore (2)", "Profession Apprentice+Journeyman (3)", "Choose: Fence+Contact (5) OR Title+Minor Fame (5) OR Short Weapons+Connections (5)"], multiclassSkills: "Choose a Lore, Library Use, Poisoner", keyFeatures: ["Practiced Manner: social discerns at level 2", "Heart of the Group: group buffs at level 3", "Stern Willed: mental defense at level 4", "Bodyguard bond mechanic"] },
  Sourcerer: { type: "Arcane Spellcaster", role: "Arcane Striker", spellcaster: true, magicType: "Arcane", description: "Raw arcane power. Internal Arcane Source replaces a Spellbook. Devastating alpha strikes. Cannot use non-Barrier armor when casting.", startingSkills: ["Basic Arcane (4)", "Warcaster (5)", "Choose: Extended Capacity-Novice×2 (6) OR Additional Cantrip (6) OR Patron+Gift of Hateful Retribution I (6)"], multiclassSkills: "Basic Arcane", keyFeatures: ["Internal Battery: self-recharge mechanic at level 1", "Astride the Weave: unique combat/casting stance at level 2", "Cancel cantrip free at level 2", "No Spellbook — Bookcaster-related skills unavailable"], note: "Cannot use non-Barrier armor while using Astride the Weave or Packet spells." },
};

const LINEAGES = {
  Aewen: { description: "Profoundly arcane. Short-lived (rarely past 30) but radiant. Natural magic affinity.", costume: "Hard", sublineages: ["Shorn Urbanite (Civilization: The Shorn)", "Accented (any non-Void/Divine Accent)"], challenges: [{ name: "Mana Lines [Repped]", lbp: 2, desc: "Brightly colored mana lines on skin in makeup or patterned cloth." }, { name: "Pointed Ears [Repped]", lbp: 1, desc: "Ears grow to pointed tips." }, { name: "Arcane Glow [Repped]", lbp: 2, desc: "Glow from arcane energy—glitter or light prosthetics." }, { name: "Deathbound", lbp: 7, desc: "Immediately discorporates to Spirit Form on death." }, { name: "Runic Lattice [Repped] (Shorn Urbanite)", lbp: 3, desc: "Significant runic patterns on clothes and skin." }, { name: "Focal Totem [Repped] (Shorn Urbanite)", lbp: 4, desc: "Totem on shoulder. If Shattered or stolen, -1 Max LP until remade." }, { name: "Bugs in the Sigils (Shorn Urbanite)", lbp: 2, desc: "Add +2 Dark Territory to any ritual you participate in." }, { name: "Neglected Conditioning (Shorn Urbanite)", lbp: 3, desc: "Purchased Martial Skills cost +1 BP." }, { name: "Elemental Expression [Repped] (Accented, Required)", lbp: 2, desc: "Physical indicator of your Accent type in costuming and makeup." }, { name: "Power Shines Through the Eyes [Repped] (Accented)", lbp: 3, desc: "Eyes match your Accent—represented by contacts." }], advantages: [{ name: "Arcane Sensitivity", lbp: 4, desc: "Enhanced ability to sense and identify magical effects." }, { name: "Conduit", lbp: 6, desc: "A spell-slot from another caster can be channeled through you." }, { name: "Natural Mage", lbp: 3, desc: "Learn an additional Arcane cantrip without prerequisites." }, { name: "Mental Bastion (Accented/Psion)", lbp: 4, desc: "Resistance to Mind Accent (uses = character level per Long Rest)." }, { name: "Ward Against the Void (Aurosian Human)", lbp: 4, desc: "Resistance to Void accent (uses = Max LP per Long Rest)." }] },
  Chimera: { description: "Formed of multiple creature aspects. Highly varied. Part bestial, part mortal.", costume: "Hard", sublineages: ["Feral (beast-dominant)", "Psion (mind-dominant)"], challenges: [{ name: "Beast Features [Repped]", lbp: 3, desc: "Visible animal features—horns, scales, tails, etc." }, { name: "Inhuman Physiology", lbp: 4, desc: "Body doesn't work like others. Various mechanical drawbacks." }, { name: "Feral Instinct", lbp: 2, desc: "Subject to Berserk in high-stress situations." }, { name: "Psionic Feedback (Psion)", lbp: 3, desc: "When Mind effects are used near you, you take 1 damage." }], advantages: [{ name: "Mental Bastion", lbp: 4, desc: "Resistance to Mind Accent (uses = character level per Long Rest)." }, { name: "Psionic Cantrip", lbp: 5, desc: "Learn an Arcane or Divine cantrip. Cast by spending a Spike. Incant replaced with 'Psionic <name>'." }, { name: "Beast Strength", lbp: 4, desc: "Enhanced physical capability in combat." }] },
  Forged: { description: "Constructed from non-organic matter. Wide range of sentience. Some unthinking, others highly intelligent.", costume: "Hard — must appear clearly non-organic", sublineages: ["Awakened (intelligent, sentient)", "Animated (purpose-built)"], challenges: [{ name: "Constructed Form [Repped]", lbp: 3, desc: "Visible non-organic materials in appearance—metal, stone, wood." }, { name: "No Life-Force", lbp: 5, desc: "Cannot be healed by standard Healing effects. Only Rebuild/repair works." }, { name: "Cold Chassis", lbp: 2, desc: "Vulnerable to Ice accent effects." }], advantages: [{ name: "Armored Shell", lbp: 4, desc: "Innate Natural Armor points." }, { name: "Mindless Immunity", lbp: 3, desc: "Immune to Mind-based effects." }, { name: "Construct Repair", lbp: 3, desc: "Can be Rebuilt by a Tinker instead of healed by Medicine." }] },
  Human: { description: "Adaptable and varied. Common across all civilizations.", costume: "Easy", sublineages: ["Aurosian (Civilization: Auros)", "Psion (mind-gifted)"], challenges: [{ name: "Cultural Marker [Repped]", lbp: 1, desc: "Visible mark of civilization or culture." }, { name: "Bound by Oath", lbp: 2, desc: "Character is bound by a cultural or personal oath." }, { name: "Seasonal Sensitivity (Aurosian)", lbp: 2, desc: "Particularly affected by in-game seasonal changes." }], advantages: [{ name: "Ward Against the Void (Aurosian)", lbp: 4, desc: "Resistance to Void accent (uses = Max LP per Long Rest)." }, { name: "Adaptive Physiology (Aurosian)", lbp: 6, desc: "Resistance to Flame and Ice accents (uses = half level rounded down)." }, { name: "Natural Affinity (Aurosian)", lbp: 4, desc: "Learn one Druid Divine Cantrip without prerequisites." }, { name: "Won't Stay Dead (Aurosian)", lbp: 3, desc: "Gain Carnal Creature, Holding On, and Will to Live as Lineage Advantages." }, { name: "Mental Bastion (Psion)", lbp: 4, desc: "Resistance to Mind Accent (uses = character level per Long Rest)." }, { name: "Psionic Cantrip (Psion)", lbp: 5, desc: "Learn an Arcane or Divine cantrip. Cast by spending a Spike." }] },
  Lost: { description: "Returned from the Void. Voidborn + Living types. Must contend with a great hunger. Can resemble any lineage but only use Lost challenges/advantages.", costume: "Hard — must have Scarred by the Void + one other [Repped]", sublineages: ["Intervened (rescued by a Divine Being)", "Fractured (multiple minds, one body)"], challenges: [{ name: "Born of the Void [Required]", lbp: 0, desc: "Inherent Voidborn + Living type. Always required, costs 0 LBP." }, { name: "Scarred by the Void [Repped] [Required]", lbp: 3, desc: "Dark blue markings—veins, streak in hair, etc. Required." }, { name: "Lost Life [Repped]", lbp: 3, desc: "Retain appearance of former lineage. Choose one [Repped] challenge from another lineage." }, { name: "Visions of Stars [Repped]", lbp: 3, desc: "Eyes reflect the Void—black, white, or dark blue contacts." }, { name: "Limited Stores", lbp: 2, desc: "Vulnerable to the Drain Effect." }, { name: "Acquired Taste", lbp: 3, desc: "Must feed on living essence daily or become Slowed. Requires Consume Vitality." }, { name: "Reborn [Required] (Intervened)", lbp: 0, desc: "Also have the Exalted type. Always required for Intervened." }, { name: "Divine Tenet [Repped] (Intervened)", lbp: 3, desc: "Etched tenet on skin. Must obey—failure = Death Final." }, { name: "Divine Brand [Repped] (Intervened)", lbp: 2, desc: "Savior's sigil branded on skin." }, { name: "Ragdoll (Intervened)", lbp: 5, desc: "Vulnerable to Root and Imprison effects." }, { name: "Something to Prove (Intervened)", lbp: 2, desc: "Gain Truthbound flaw as a Lineage Challenge." }, { name: "Additional Lost Life [Repped] (Fractured)", lbp: 3, desc: "Appearance from a second lineage. Requires Lost Life." }, { name: "Void-filled Gaps [Repped] (Fractured)", lbp: 4, desc: "Gaps in physical form filled by void—painted skin or patterned sleeves." }, { name: "Fragile Form (Fractured)", lbp: 5, desc: "-1 Max LP. Cannot be taken if already at 1 Max LP." }, { name: "Unstable Form [Repped] (Fractured)", lbp: 7, desc: "Must add pieces of consumed creatures to form. Requires Consume Vitality." }], advantages: [{ name: "Consume Vitality", lbp: 3, desc: "Consume a helpless target (Focus Slow 30): kill them, Heal 3 to self by Void, Refresh 1 Spike. Short Rest." }, { name: "Creature of Void", lbp: 4, desc: "Immune to periodic damage and Environmental Effects in Void areas." }, { name: "Void Strikes", lbp: 4, desc: "Add Void Accent to base melee damage (no stack with other damage effects)." }, { name: "Void Resistance", lbp: 6, desc: "Resistance to Void accent (uses = Character Level per Long Rest)." }, { name: "Power from the Gods (Intervened)", lbp: 8, desc: "Choose a Divine Domain from your saving Divine Being. May exceed normal Domain max." }, { name: "Divine Armaments (Intervened)", lbp: 3, desc: "Add Divine Accent to a weapon strike, Spell, or Power by spending a Spike." }, { name: "Close Connection (Intervened)", lbp: 4, desc: "Gain Patron perk as a Lineage Advantage. Patron = the Divine Being that intervened." }, { name: "Divine Magic (Intervened)", lbp: 4, desc: "Learn one Cantrip from any Divine class without prerequisites." }] },
  Oaksworn: { description: "Deeply connected to nature and great forests. Long-lived and deliberate.", costume: "Medium", sublineages: ["Verdant (plant-attuned)", "Stoneback (earth-attuned)"], challenges: [{ name: "Bark Skin [Repped]", lbp: 3, desc: "Visible bark-like skin texture in makeup or prosthetics." }, { name: "Slow Growth", lbp: 2, desc: "Cannot benefit from some fast-acting effects." }, { name: "Forest Bound", lbp: 3, desc: "Uncomfortable indoors for extended periods—mechanical penalties." }], advantages: [{ name: "Natural Armor", lbp: 4, desc: "Innate Natural Armor from bark-like skin." }, { name: "Commune with Flora", lbp: 3, desc: "Communicate with plants and trees to gather information." }, { name: "Forest Sense", lbp: 2, desc: "Enhanced awareness of natural environments." }] },
  Ogrim: { description: "Physically powerful and resilient. Less common but formidable in combat.", costume: "Medium", sublineages: ["Mountainborn", "Swampborn"], challenges: [{ name: "Imposing Form [Repped]", lbp: 2, desc: "Visually imposing—padding, makeup, or large costuming." }, { name: "Crude Manners", lbp: 2, desc: "Social penalties in formal situations." }, { name: "Lumbering Gait", lbp: 3, desc: "Cannot use Two Weapon Style or advanced mobility powers." }], advantages: [{ name: "Brute Strength", lbp: 4, desc: "Enhanced carrying capacity and physical ability checks." }, { name: "Thick Hide", lbp: 3, desc: "Natural armor from tough, leathery skin." }, { name: "Unstoppable", lbp: 5, desc: "Resistance to Slow and Root effects." }] },
  Underkin: { description: "Underground-dwelling lineage. ~90 year lifespan. Adapted to dark environments.", costume: "Easy to Medium", sublineages: ["Deepdweller", "Surfacewalker"], challenges: [{ name: "Light Sensitivity [Repped]", lbp: 2, desc: "Eyes sensitive to bright light—squinting or tinted eyewear." }, { name: "Small Stature", lbp: 1, desc: "Shorter than average—some interactions affected." }, { name: "Tunnel Vision", lbp: 2, desc: "Peripheral awareness reduced in open areas." }], advantages: [{ name: "Darkvision", lbp: 3, desc: "Can see normally in low-light conditions others cannot." }, { name: "Stonecunning", lbp: 2, desc: "Enhanced notice of stonework, traps, and underground features." }, { name: "Sure-Footed", lbp: 2, desc: "Cannot be tripped; advantage on difficult terrain." }] },
};

const DEVOTIONS = [
  { name: "The Mother", locality: "Auros", domains: ["Life", "Creation", "Protection"], color: "Gold", tenets: "Life is beautiful—revel in it. Help others begin their journeys. Protect the path for everyone, forever." },
  { name: "The Steed", locality: "Empire of Light", domains: ["War", "Order", "Light", "Energy: Fire"], color: "Red & White", tenets: "Strength and conquest above all. Protect willing servants. Honor the strong you fight. No other gods." },
  { name: "Senri, Voice of Mercy", locality: "Shorn", domains: ["Peace", "Destruction"], color: "White with red", tenets: "Death is the final stroke—only when no other way. Inaction = complicity. Seek recompense for harm caused." },
  { name: "Dorne, Bringer of Law", locality: "Shorn", domains: ["Order", "Light"], color: "Red & Gold", tenets: "Live intentionally. Bring structure to your community. Keep your word; punish those who do not." },
  { name: "Filian", locality: "Shorn", domains: ["Manipulation", "Life"], color: "", tenets: "" },
  { name: "Mille", locality: "Shorn", domains: ["Expression", "Creation"], color: "", tenets: "" },
  { name: "The Song In Iron", locality: "Streams in Silver", domains: ["Creation", "Protection", "War"], color: "", tenets: "" },
  { name: "Dave", locality: "The Traveling Star", domains: ["Life", "Expression", "Creation", "Chaos"], color: "", tenets: "" },
  { name: "The Great Mind", locality: "Unified Technarchy", domains: ["Knowledge", "Order", "Energy: Lightning"], color: "", tenets: "" },
  { name: "Druidism", locality: "Universal", domains: ["Nature", "Chaos", "Expression"], color: "", tenets: "Protect nature. Respect the cycle of life and death. The land provides, and must be honored." },
  { name: "The Howl at the End", locality: "Universal", domains: ["Death", "Shadow", "Destruction"], color: "", tenets: "" },
  { name: "The Divine Bloom", locality: "Universal", domains: ["Chaos", "Knowledge"], color: "", tenets: "" },
  { name: "The Witch of Webs", locality: "Universal", domains: ["Chaos", "Nature"], color: "", tenets: "" },
  { name: "The Pale Star", locality: "Universal", domains: ["Energy: Ice", "Shadow"], color: "", tenets: "" },
  { name: "Devourer", locality: "Universal", domains: ["Destruction", "Energy: Acid"], color: "", tenets: "" },
  { name: "The Librarian", locality: "Universal", domains: ["Knowledge", "Shadow", "Manipulation"], color: "", tenets: "" },
  { name: "Wildfire", locality: "Universal", domains: ["Energy: Fire", "Nature", "Destruction"], color: "", tenets: "" },
  { name: "The Dancer", locality: "Universal", domains: ["Expression", "Death"], color: "", tenets: "" },
  { name: "Undevoted", locality: "Universal", domains: [], color: "", tenets: "No divine patron. Relies on personal strength alone. Cannot access Divine Domains." },
];

// ─────────────────────────────────────────────────────────────────────────────
// CLASS POWERS
// ─────────────────────────────────────────────────────────────────────────────

// Level 4 power slots per class
const CLASS_POWER_SLOTS = {
  Artisan:   { utility: 2, basic: 2, advanced: 0, veteran: 0 },
  Fighter:   { utility: 2, basic: 2, advanced: 0, veteran: 0 },
  Rogue:     { utility: 2, basic: 2, advanced: 0, veteran: 0 },
  // Socialite: level 2 innate Practiced Manner grants +1 Basic, so 3 total at level 4
  Socialite: { utility: 2, basic: 3, advanced: 0, veteran: 0 },
  // Spellcasters: 2 cantrips, 4 spells known, slots 4/0/0
  Cleric:    { cantrips: 2, spellsKnown: 4, slots: "4 Novice / 0 Adept / 0 Greater" },
  Druid:     { cantrips: 2, spellsKnown: 4, slots: "4 Novice / 0 Adept / 0 Greater" },
  Mage:      { cantrips: 2, spellsKnown: 4, slots: "4 Novice / 0 Adept / 0 Greater" },
  Sourcerer: { cantrips: 2, spellsKnown: 4, slots: "4 Novice / 0 Adept / 0 Greater" },
};

const ARTISAN_POWERS = {
  utility: [
    { name: "A Spoonful of Sugar", tag: "Crafter", desc: "Gain Apprentice Alchemy. Once/LR remove Mana Sickness from one alchemical item you craft.", refresh: "Long Rest" },
    { name: "Adept Ritualist", tag: "Mystic", desc: "Gain Apprentice Ritual Magic. Count as two Ritual Participants; scaling bonuses at levels 3 and 7.", refresh: "Passive" },
    { name: "Apt Assistant", tag: "Crafter", desc: "Halve repeated task repetitions and timer turns when helping at any Crafting Station.", refresh: "Immediate" },
    { name: "Custom Creation", tag: "Crafter", desc: "Gain Apprentice Enchanting. Focus Quick 100 to add Attunement requirements or use limitations to your crafted items.", refresh: "Immediate" },
    { name: "Forged From Steel", tag: "Artificer", desc: "+1 Mend Point per Artisan level to Living Iron pool. May sacrifice a Forgesource for 10 Mend Points.", refresh: "Passive" },
    { name: "Forgesource Specialist", tag: "Artificer/Crafter", desc: "Gain Apprentice Tinkering. Make Forgesources as Apprentice Tinker; craft two simultaneously; replace Uncommon resources with Forgesources.", refresh: "Passive" },
    { name: "Good Timing", tag: "Crafter", desc: "Gain Prospect I. May take Prospect III before level 10. Skip prospecting in first LR to prospect twice per mine in next LR.", refresh: "Passive" },
    { name: "Hunter Gatherer", tag: "Crafter", desc: "Gain Forage I. May take Forage III before level 10. Take 1 additional Night Prize per patch per Foraging rank.", refresh: "Passive" },
    { name: "Mechanical Augmentation", tag: "Artificer", desc: "Become a powered construct for a Short Rest (requires Forgesource). Spend Spikes in place of Forgesources for self-targeting Powers. Counter Poison/Agony/Fear for 4 Living Iron.", refresh: "Long Rest" },
    { name: "Otherworldly Sight", tag: "Mystic", desc: "Focus Quick 100: Subtle Discern Lineage or Exalted/Undead/Voidborn type of one target.", refresh: "Immediate" },
    { name: "Perspicacity", tag: "Artificer/Mystic", desc: "Focus Quick 100: Subtle Discern one Vulnerability of a target.", refresh: "Immediate" },
    { name: "Protected Casting", tag: "Mystic", desc: "Consecrate a rope circle (≤100 ft). Ritualists inside resist Weapon and Packet damage without disrupting the Ritual.", refresh: "Long Rest" },
    { name: "Shield Bearer", tag: "Artificer", desc: "Gain Basic Shield skill. Sacrifice 2 LP to Counter any Disarm Effect against your shield.", refresh: "Immediate" },
    { name: "Smithy's Blessing", tag: "Artificer", desc: "Mend 1 to own armor whenever you administer a Health Draught to another or expend a Forgesource.", refresh: "Immediate" },
    { name: "Spirit Guide", tag: "Mystic", desc: "Gain the Supernatural Perk: Medium.", refresh: "Passive" },
    { name: "Tanner", tag: "Crafter", desc: "Gain Scavenge I. May take Scavenge III before level 10. Instantly Scavenge; Counter damage while waiting for your token.", refresh: "Immediate" },
    { name: "Triage", tag: "Mystic", desc: "Gain Basic Medicine and Diagnose. Additional Diagnose questions about emotional state, substances, Spirit Form, memory alteration, possession, and profession.", refresh: "Immediate" },
  ],
  basic: [
    { name: "Acid Soak", tag: "Artificer", desc: "Focus Quick 100, sacrifice 3 Night Prizes: throw a packet for 'Wounding 8 by Acid'.", refresh: "Short Rest" },
    { name: "Aegis/Sundering of the Unknown", tag: "Mystic", desc: "Touch a target: modify their Dark Territory by ±1 until next Short Rest. Enhancement: sacrifice 3 Rare Minerals for ±2.", refresh: "Long Rest" },
    { name: "Analysis", tag: "Crafter", desc: "Focus Quick 100 + Touch: read an item's information card ('Subtle Discern by Mind: properties').", refresh: "Short Rest" },
    { name: "Antidote", tag: "Crafter", desc: "1 minute RP: Cure Drained/Slept/Tainted. Enhancement: expend a Bloom to Cure All Conditions.", refresh: "Short Rest" },
    { name: "Armor Upkeep Specialist", tag: "Artificer/Crafter", desc: "Create a Specialist Field Patch Kit that mends armor to full once/LR without consuming the Kit.", refresh: "Long Rest" },
    { name: "Blood Scroll", tag: "Crafter", desc: "Sacrifice 1 LP to skip the Simple Ink requirement when scribing one Novice Scroll.", refresh: "Long Rest" },
    { name: "Borrow Knowledge", tag: "Mystic", desc: "Out of combat, Touch a willing creature and Discern all their Lore skills, gaining them until your next Short Rest.", refresh: "Short Rest" },
    { name: "Combat Analysis", tag: "Artificer", desc: "Focus Quick 30 watching enemies: Counter one Weapon attack from that group. Call: 'Counter, Dodge'.", refresh: "Short Rest" },
    { name: "Create Infusion", tag: "Crafter", desc: "When using Delve Reality, create an Essence Infusion without additional resources or alchemy.", refresh: "Long Rest" },
    { name: "Critique Construction", tag: "Artificer", desc: "Focus Quick 100 + Touch: grant another character one use of 'Shatter Shield' against a shield.", refresh: "Short Rest" },
    { name: "Custom Brew (×3)", tag: "Crafter", desc: "Reduce one Bloom or Night Prize requirement in your alchemy crafting by 1 (minimum 1).", refresh: "Long Rest" },
    { name: "Dig Deep", tag: "Mystic", desc: "Focus Quick 30 + short speech: up to 6 others gain the ability to Refresh all Spikes once before their next Short Rest.", refresh: "Long Rest" },
    { name: "Forcefield", tag: "Artificer", desc: "Focus + Forgesource: Grant Protect vs Packets by Lightning to one target. Enhancement: expend Forgesource for up to 5 targets.", refresh: "Long Rest" },
    { name: "Intimidating Spines", tag: "Artificer", desc: "Call 'Short Repel by Fear' verbally against one target for a Short Rest.", refresh: "Short Rest" },
    { name: "Jury Rig", tag: "Artificer", desc: "Focus Quick 30: Mend 5 to armor. Enhancement: expend 2 ingots or a Patch Kit to immediately refresh.", refresh: "Long Rest" },
    { name: "Kick", tag: "Crafter", desc: "1 minute RP: add Heal 1, Grant 1 Barrier, or Intoxicate to an existing potion. No potion can be Kicked twice.", refresh: "Immediate" },
    { name: "Mesmerize", tag: "Mystic", desc: "Out of combat, after 1 minute conversation: 'Short Charm by Mind' on target. No effect for Artificer/Crafter Artisans.", refresh: "Long Rest" },
    { name: "Overcharge", tag: "Artificer", desc: "Focus + Forgesource: Grant self +1 Bonus Spike Damage until next Short Rest. Enhancement: sacrifice Forgesource for +2.", refresh: "Long Rest" },
    { name: "Reconstitute Summon", tag: "Mystic", desc: "Touch another: 'Mend Summoned Armor to Full and Grant Three Barrier by Mind'.", refresh: "Short Rest" },
    { name: "Share", tag: "Mystic", desc: "Out of combat: spend a minute sharing feelings with a target. Until end of Event, once Cure that target of Dominated/Charmed/Obedient/Fear conditions.", refresh: "Short Rest" },
    { name: "Spiritual Anchor", tag: "Mystic", desc: "Verbal: 'Short Grant resistance to Insubstantial' on one target.", refresh: "Long Rest" },
    { name: "Trap Recovery", tag: "Artificer", desc: "Focus Quick 100: gather pieces of your own expended trap to remake it free, or convert to component resources (minus one).", refresh: "Long Rest" },
    { name: "Treat", tag: "Artificer/Mystic", desc: "Out of combat, expend 3 Bloom: Heal 1 LP to up to 6 targets (Focus Slow 10 per target).", refresh: "Short Rest" },
    { name: "Warming Elixir / Cooling Draught", tag: "Crafter", desc: "Expend 1 Bloom to brew: Grant Protect vs Ice by Flame OR Protect vs Flame by Ice to up to 4 targets.", refresh: "Short Rest" },
    { name: "Weapon Upkeep Specialist", tag: "Crafter", desc: "Create a Perfect Sharpening Stone (1 year exp): grants +1 Bonus Spike Damage until next Short Rest (one use).", refresh: "Long Rest" },
    { name: "Weird Wanderings", tag: "Mystic", desc: "Choose one Basic-Tier Power from any other non-Artisan Base Class permanently. Cannot be a Spell-refresh Power.", refresh: "Passive" },
  ],
};

const FIGHTER_POWERS = {
  utility: [
    { name: "Armored Shell", prereq: "Light Armor", desc: "Passive: while wearing ≥4 AP of physical armor, gain +1 to Base Maximum Armor Points.", refresh: "Passive" },
    { name: "Bowyer", desc: "Focus Quick 100: Rebuild a shattered projectile weapon. Out of combat: Focus Quick 100 to gain +1 Bonus Spike Damage on your first Spike with a projectile weapon.", refresh: "Immediate" },
    { name: "Execute", desc: "Gain Hard to Kill and Carnal Creature perks. Instead of a Deathblow, instantly kill a Helpless creature with 'Death to Helpless'.", refresh: "Immediate" },
    { name: "Fortitude", desc: "Counter any Disable or Disarm Effect. Alternatively, Cure the Disabled condition on yourself.", refresh: "Short Rest" },
    { name: "Knight's Strength", desc: "Short burst of great strength: complete one carry/open one obstacle, or gain +1 Bonus Spike Damage on next Spike attack.", refresh: "Short Rest" },
    { name: "Lessons from Scars", desc: "Gain Lore: Historical and Lore: Noble. Verbal Discern: target's Maximum Life Points.", refresh: "Short Rest" },
    { name: "Linked Armor", prereq: "Light Armor", desc: "Gain Medium Armor skill. While wearing ≥5 AP of physical armor, Grant 1 Barrier to self after each Short Rest (RP patching).", refresh: "Short Rest" },
    { name: "Reload", desc: "Move away from combat, go Insubstantial, collect up to 6 pieces of projectile ammo or thrown weapons, then Cure Insubstantial.", refresh: "Short Rest" },
    { name: "Renowned Soldier", desc: "Gain Minor Fame and Apprentice Profession (military background). Counter one Fear-accented Effect once per Short Rest.", refresh: "Short Rest" },
    { name: "Scales of the Serpent", prereq: "Medium Armor", tag: "Reinforce", desc: "Gain Heavy Armor skill. While wearing ≥7 AP with ≥1 AP remaining, Counter one Wounding attack per Short Rest.", refresh: "Short Rest" },
    { name: "Shoulder", desc: "Running start into a door, wall, or immobile obstacle: Shatter it. Refreshes after Focus Quick 100. No effect on held objects.", refresh: "Focus Quick 100" },
    { name: "Wall of Steel", prereq: "Heavy Armor", tag: "Reinforce", desc: "Gain Ironclad Armor skill. While wearing ≥10 AP on both Upper and Lower Torso with ≥1 AP remaining, Counter one Piercing attack per Short Rest.", refresh: "Short Rest" },
  ],
  basic: [
    { name: "Battlemind (×2)", desc: "Focus Slow 60 meditation: +2 Maximum (and current) Spikes until next Short Rest.", refresh: "Long Rest" },
    { name: "Disarming Strike (×5)", desc: "Expend a Spike with a weapon strike: 'Quick Disarm [Item] by Force'.", refresh: "Short Rest" },
    { name: "Disengage (×3)", desc: "Weapon attack or Verbal (with projectile in hand): 'Quick Repel by Mind' against one target.", refresh: "Short Rest" },
    { name: "Flaming Arrow (×5)", desc: "While using a projectile weapon, up to 2 shots deal 'Wounding 5 by Flame' per Short Rest.", refresh: "Short Rest" },
    { name: "Grit (×3)", tag: "Reinforce", desc: "Counter one damaging Packet attack ('Counter, Grit'). Leaves you Drained Quick 100; spend a Spike + 1 LP to negate the Drain.", refresh: "Short Rest" },
    { name: "Harry", tag: "Reinforce", desc: "Melee weapon strike: 'Quick Provoke by Mind'. Expend a Spike to immediately refresh.", refresh: "Short Rest" },
    { name: "Heroic Save (×2)", desc: "Go Insubstantial, rush to a downed ally, pick them up with one hand. Gain Resist Damage and Effects while carrying. Lasts while carrying or Slow 60 max.", refresh: "Short Rest" },
    { name: "Patchwork Defense", prereq: "Parry Blow", desc: "Once/LR: after physical armor is repaired with a Patch Kit, Refresh Parry Blow.", refresh: "Long Rest" },
    { name: "Raging Blows (×2)", desc: "Great weapon, two hands + ROAR incant: 'Shatter Shield'. Enhancement: expend a Spike to skip the incant.", refresh: "Short Rest" },
    { name: "Resolve (×2)", tag: "Reinforce", desc: "After an Effect or Damage that would take you to 0 LP or kill you: 'Altered, Resolve' — reduced to 1 LP instead.", refresh: "Long Rest" },
    { name: "Shake It Off I", tag: "Reinforce", desc: "Reduce one Quick 100 or Short duration Effect to Quick 30. Must bellow/yell when the duration ends.", refresh: "Short Rest" },
    { name: "Shot Placement (×2)", desc: "One melee attack for 4 damage (or 8 with a Great Weapon).", refresh: "Short Rest" },
    { name: "Smite (×2)", desc: "One melee attack: 'Wounding [Base Damage +2]' (or Base Damage +3 with Great Weapon only).", refresh: "Short Rest" },
    { name: "Snap Shot (×3)", desc: "While using a projectile weapon, Verbal: 'Quick Root' on one target.", refresh: "Short Rest" },
    { name: "Stifle", desc: "Projectile weapon attack: 'Short Silence' on a target (aim for torso, not neck).", refresh: "Short Rest" },
    { name: "Twin Shot", desc: "Fire two identical consecutive projectile shots. If both land, apply the first shot's call to the second.", refresh: "Short Rest" },
  ],
};

const ROGUE_POWERS = {
  utility: [
    { name: "Acquired Tolerance", desc: "Counter one Poison-accented Attack or Effect per Short Rest.", refresh: "Short Rest" },
    { name: "Back Alley Deals", desc: "Gain Fence skill. Once/Event: access underworld contacts for favors (spread rumors, info, healing, fencing, alchemy, resources) at listed Wealth costs; costs halved if used during Pre-Registration.", refresh: "Event" },
    { name: "Catfall", desc: "Gain Agility perk. Sacrifice 1 LP: Counter damage and Effects from a fall.", refresh: "Focus Quick 100" },
    { name: "Contract Killing", desc: "Pay 20 Wealth to Staff: place a bounty on a named individual for the Event. Gain +1 Base Damage against them. Anyone who knows about the bounty can collect it.", refresh: "Event" },
    { name: "Keen Hearing", prereq: "Rogue Level 6", desc: "Focus Quick 100: 'By My Voice, Subtle Expose Living' — pinpoint all living creatures in the area.", refresh: "Short Rest" },
    { name: "Mine", desc: "Slow Count 120: booby-trap yourself. If searched before next LR: mechanical trap deals 8 damage, chemical deals 12 Poison damage to the searcher.", refresh: "Upon Discharge" },
    { name: "Reload", desc: "Move away from combat, go Insubstantial, collect up to 6 personal projectiles/thrown weapons/spell-packets, then Cure Insubstantial.", refresh: "Short Rest" },
    { name: "Rogue's Touch", desc: "When failing a mundane lock attempt with a time penalty: call 'Rogue's Touch' to try again from the beginning.", refresh: "Immediate" },
    { name: "Size Up", desc: "Focus Quick 100 observation: Verbal Discern whether target carries more than [X] Wealth. Once per Short Rest per target.", refresh: "Immediate" },
    { name: "Studded Leather Armor", desc: "Passive: while wearing ≤4 AP of physical armor, gain +1 to Base Maximum Armor Points.", refresh: "Passive" },
    { name: "Throat Slit", desc: "Gain Deathgrip and Holding On perks. Instead of a Deathblow, instantly kill a Helpless creature.", refresh: "Immediate" },
    { name: "Way of the Blade", desc: "Gain Two Weapon Style and Weapon Specialization (Swords, Thrown Weapons, or Daggers).", refresh: "Passive" },
    { name: "What We Do", desc: "Gain either Basic Locks or Basic Traps skill for free.", refresh: "Passive" },
  ],
  basic: [
    { name: "Blunt End (×2)", desc: "Thrown weapon: 'Quick Sleep by Force' on a target.", refresh: "Long Rest" },
    { name: "Concealed Dart", desc: "Focus Quick 30 out-of-combat prep: thrown weapon attack for Wounding equal to your Max LP, OR Quick Sleep, OR Short Silence.", refresh: "Short Rest" },
    { name: "Evasion", desc: "While you have no Maximum Armor and no Barrier: Counter one Weapon or Packet attack ('Counter, Dodge').", refresh: "Short Rest" },
    { name: "Expert Deflect", desc: "Counter any thrown weapon or projectile by catching/deflecting with your hands before it hits non-hand body parts.", refresh: "Focus Quick 100" },
    { name: "Flash Attack (×3)", desc: "Weapon attack: 'Short Weakness' on a target.", refresh: "Short Rest" },
    { name: "Hamstring (×3)", desc: "Weapon attack: 'Short Root by Force' on a target.", refresh: "Short Rest" },
    { name: "Improvised Weapon", desc: "Spend a Spike: mime throwing a non-weapon object, call '[Name] [Spike Damage]' verbally.", refresh: "Short Rest" },
    { name: "Keen Eye (×3)", desc: "Focus Quick 100: read an item's information card or ask a Marshal about a container's contents.", refresh: "Long Rest" },
    { name: "Precision Strike", desc: "From behind + expend a Spike: 'Piercing 3'. If Prevented, immediately refreshes (different target required).", refresh: "Long Rest" },
    { name: "Quick Nap", desc: "After being Dying or Slept for Slow 30: Heal 1 LP and Cure Slept on yourself (usable while unconscious).", refresh: "Long Rest" },
    { name: "Reflexive Strike", desc: "Whenever you use a 'Dodge' defense: immediately make an attack for 'Wounding 2' (must be your very next attack).", refresh: "Instantaneous" },
    { name: "Rogue's Aim (×3)", desc: "Add the Wounding effect to one thrown weapon attack per Short Rest.", refresh: "Short Rest" },
    { name: "Scarper (×2)", desc: "Weapon attack from behind: 'Quick Repel by Force'. If the target is helpless, no need to be behind them.", refresh: "Short Rest" },
    { name: "Skullduggery", desc: "Out of combat, 1 minute RP: attempt to pick a pocket or plant an item without the target noticing.", refresh: "Short Rest" },
    { name: "Sneak Attack", desc: "Attack from behind: call your Spike Damage as Wounding. If the target is Slept, increase Wounding by 2.", refresh: "Short Rest" },
    { name: "Vanish", desc: "Expend a Spike: go Insubstantial for Quick 30 and move to a new location. Cure Insubstantial when the count ends.", refresh: "Short Rest" },
  ],
};

const SOCIALITE_POWERS = {
  utility: [
    { name: "Aesthetic Suggestion", desc: "Once/LR: give a Crafter a minor boon to their current crafting (remove/add Dark Territory, weapon bonus spike, armor resist Shatter, double trap damage, or +3 healing item effect).", refresh: "Long Rest" },
    { name: "Headliner", prereq: "Profession – Journeyman", desc: "Gain Profession – Master. Connections provide transport and services. Once/Event: refresh Bits and Pieces perk if you have it.", refresh: "Event" },
    { name: "Implicit Truths", desc: "Gain the Insight perk. When using Insight, also ask: 'Is there a timer on this puzzle?' and 'Is this action likely to end disastrously?'", refresh: "Long Rest" },
    { name: "It's Who You Know", desc: "Once/Event: exchange up to 15 Basic Resources (Hide/Ingot/Bloom) or 7 Uncommon Resources + 2 Wealth with off-stage contacts for equal-rank resources of your choice.", refresh: "Event" },
    { name: "Never Stop Learning", prereq: "Socialite Level 6", desc: "After 1–2 minutes of interaction: Verbal Discern what in-game Core Skill the target is demonstrating. Gain that Skill until next Long Rest.", refresh: "Long Rest" },
    { name: "Pit Master", desc: "Gain 4 Wealth per Event at Logistics. Once/SR: serve as intermediary for a duel between two willing combatants with specific duel rules.", refresh: "Short Rest" },
  ],
  basic: [
    { name: "Calming Tone", desc: "Verbal: Cure Provoked/Berserk/Repelled/Intoxicated on a target. Out of combat: after 1 minute soothing talk, also cure Nightmares Flaw effects.", refresh: "Short Rest" },
    { name: "Curiosity Killed the Cat", desc: "Spend 2 minutes to booby-trap one personal container. Mechanical trap: 10 damage; Chemical: 16 damage + destroys flammables. One trapped container at a time.", refresh: "Immediate" },
    { name: "Deducing the Apparent", desc: "Out of combat, Verbal Discern: ask a number of questions equal to your Socialite levels per LR from a specific list (kills, honesty, origin, class, profession, civilization, devotion).", refresh: "Long Rest" },
    { name: "Diplomatic Immunity", desc: "Raise hands (optional white flag): 'Short Grant Insubstantial'. Ends when hands lower/move or feet move. Cannot Rest while active.", refresh: "Long Rest" },
    { name: "Don't You Know Who I Am?", desc: "Once/SR: state one true fact about yourself in the 'It Has Been Told…' format to reinforce your credentials. May be reasonably embellished.", refresh: "Short Rest" },
    { name: "Enthrall", desc: "After 1 minute of compliments out of combat: 'Short Charm by Mind' on target.", refresh: "Long Rest" },
    { name: "Inspiration", desc: "Once/LR per group member: give a motivating boon — Imbue weapon with Wounding 3 + Refresh LR Power, OR Imbue packet with Wounding 5 + Refresh spell slot, OR Grant 3 Barrier.", refresh: "Long Rest" },
    { name: "Intoxicating Aura", desc: "After performing for an audience: 'By My Voice…Short Intoxicate' to those who watched. Roleplay is optional and can be ended by the affected at any time.", refresh: "Short Rest" },
    { name: "Mithridatization", desc: "When applying poison to a weapon: gain Protect vs Poison by Poison. When applying to food/drink: gain Protect vs Ingested Poison by Poison.", refresh: "Short Rest" },
    { name: "Plausible Deniability", desc: "After ≥10 seconds of denial roleplay: Verbal 'Short Subtle Obey by Mind: Believe the reason I gave you until I leave your line of sight'.", refresh: "Short Rest" },
    { name: "Pocket Sand", desc: "Packet delivery: 'Short Weakness by Agony' on a target.", refresh: "Short Rest" },
    { name: "Poison Dart", desc: "Focus Quick 30 out of combat: charge a Packet or Thrown Weapon (no Thrown Weapons skill needed) with 'Short Drain by Poison'.", refresh: "Short Rest" },
    { name: "Rotten Tomato", desc: "Verbal insult incant + expend a Spike: Packet 'Quick Berserk by Mind'. Red/tomato-shaped packet refreshes on Short Rest; others on Long Rest.", refresh: "Long Rest / Short Rest" },
    { name: "Soothe", desc: "Long conversation with a Group member: ask specific wellbeing questions, then either Heal 5 or Cure All Conditions on them once per LR.", refresh: "Long Rest" },
    { name: "Sizing Up the Opposition", desc: "Focus Quick 100: Verbal Discern one of three questions per target per SR (intent to harm, willingness to negotiate, or bribability).", refresh: "Focus Quick 100" },
    { name: "Time to Go", desc: "Touch or Verbal (if targeting Bodyguard): Cure Slow/Root/Disable Leg on a target. If targeting your Bodyguard, you also receive the same Cure.", refresh: "Short Rest" },
    { name: "To Dance with Death", desc: "After dancing ≥1 minute out of combat: 'Piercing [Socialite levels] by Poison, Short Taint by Poison' on your dance partner.", refresh: "Short Rest" },
  ],
};

const CLASS_POWERS = { Artisan: ARTISAN_POWERS, Fighter: FIGHTER_POWERS, Rogue: ROGUE_POWERS, Socialite: SOCIALITE_POWERS };

const CASTER_NOTE = {
  Cleric: "At Level 4: 2 Cantrips, 4 Known Spells (any tier, record in Spellbook), and 4 Novice spell slots. Refreshing Prayer restores all Divine spell slots once per Long Rest via Short Rest prayer.",
  Druid: "At Level 4: 2 Cantrips, 4 Known Spells (Novice Spells + Form Spells), and 4 Novice spell slots. Three combat Forms available: Hulking Bear, Striking Serpent, Hunting Panther.",
  Mage: "At Level 4: 2 Cantrips, 4 Known Spells (any tier, record in Spellbook), and 4 Novice spell slots. Arcane Study restores all Arcane spell slots once per Long Rest via Short Rest study.",
  Sourcerer: "At Level 4: 2 Cantrips, 4 Known Spells (any tier, stored in Arcane Source — no Spellbook), and 4 Novice spell slots. Internal Battery provides self-recharge mechanic.",
};

const SKILL_CATS = ["Martial", "Magic", "Scholar", "Medical", "Trade", "Thieving", "Gathering", "Crafting"];
const PERK_CATS = ["Mystical", "Physical", "Patron", "Social", "Supernatural", "Hearth"];
const FLAW_CATS = ["Personal", "Physical", "Spiritual", "Oath"];

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function Tag({ label, color = "amber" }) {
  const c = {
    amber: "bg-amber-900/40 text-amber-300 border-amber-700/50",
    teal: "bg-teal-900/40 text-teal-300 border-teal-700/50",
    purple: "bg-purple-900/40 text-purple-300 border-purple-700/50",
    blue: "bg-blue-900/40 text-blue-300 border-blue-700/50",
    red: "bg-red-900/40 text-red-300 border-red-700/50",
    green: "bg-green-900/40 text-green-300 border-green-700/50",
    gray: "bg-gray-800/40 text-gray-400 border-gray-600/50",
  }[color] || "bg-stone-800/40 text-stone-400 border-stone-600/50";
  return <span className={`text-xs px-2 py-0.5 rounded border font-medium ${c}`}>{label}</span>;
}

function Accordion({ title, icon, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-stone-700/50 rounded-lg overflow-hidden mb-3">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-4 py-2.5 bg-stone-800/60 hover:bg-stone-800 text-left transition-colors">
        <span className="flex items-center gap-2 font-semibold text-amber-200 tracking-wide text-xs uppercase">{icon} {title}</span>
        <span className="text-stone-500 text-xs">{open ? "▲" : "▼"}</span>
      </button>
      {open && <div className="p-4 bg-stone-900/40">{children}</div>}
    </div>
  );
}

function BPBar({ spent, total }) {
  const pct = total > 0 ? Math.min(100, (spent / total) * 100) : 0;
  const over = spent > total;
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2 bg-stone-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${over ? "bg-red-500" : pct > 85 ? "bg-amber-400" : "bg-teal-500"}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-sm font-bold tabular-nums ${over ? "text-red-400" : "text-amber-300"}`}>{spent}/{total} BP</span>
      {over && <span className="text-red-400 text-xs font-bold">⚠ OVER</span>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

export default function WellspringCharacterCreator() {
  const [step, setStep] = useState(0);
  const [char, setChar] = useState({
    name: "", level: 4, civilization: "Auros", backstory: "",
    selectedClass: "", secondaryClass: "",
    selectedLineage: "", selectedSubLineage: "",
    selectedChallenges: [], lbpAdvantages: [],
    selectedDevotionIndex: null,
    selectedFlaws: [],
    selectedPerks: [],
    selectedSkills: [],
    selectedPowers: { utility: [], basic: [], advanced: [], veteran: [] },
  });

  const levelData = LEVEL_TABLE.find(l => l.level === char.level) || LEVEL_TABLE[0];

  // ── BP MATH ────────────────────────────────────────────────────────────────

  // Flaw BP earned (capped at 5)
  const flawBPRaw = char.selectedFlaws.reduce((sum, n) => {
    const f = ALL_FLAWS.find(x => x.name === n);
    return sum + (f ? f.bp : 0);
  }, 0);
  const flawBP = Math.min(5, flawBPRaw);

  // Backstory bonus (pending staff approval)
  const backstoryBP = char.backstory.trim().length > 20 ? 2 : 0;

  // Total BP available
  const totalBP = levelData.bp + flawBP + backstoryBP;

  // Class free skills — skills the class gives for free shouldn't count toward BP
  // We track them as "free" when player selects them from class starting skills
  // For simplicity, we show free class skills separately and auto-exclude them

  // BP spent on perks
  const perkBPSpent = char.selectedPerks.reduce((sum, n) => {
    const p = ALL_PERKS.find(x => x.name === n);
    return sum + (p ? p.cost : 0);
  }, 0);

  // BP spent on purchased skills
  const skillBPSpent = char.selectedSkills.reduce((sum, n) => {
    const s = ALL_SKILLS.find(x => x.name === n);
    return sum + (s ? s.cost : 0);
  }, 0);

  const totalSpent = perkBPSpent + skillBPSpent;
  const remainingBP = totalBP - totalSpent;

  // LBP
  const lineageData = LINEAGES[char.selectedLineage];
  const earnedLBP = Math.min(10, char.selectedChallenges.reduce((sum, n) => {
    const ch = lineageData?.challenges.find(x => x.name === n);
    return sum + (ch ? (typeof ch.lbp === "number" ? ch.lbp : 0) : 0);
  }, 0));
  const spentLBP = char.lbpAdvantages.reduce((sum, n) => {
    const adv = lineageData?.advantages.find(x => x.name === n);
    return sum + (adv ? (typeof adv.lbp === "number" ? adv.lbp : 0) : 0);
  }, 0);

  // Life points / spikes
  const bonusLP = char.selectedPerks.includes("Toughness") ? 1 : 0;
  const totalLP = levelData.lp + bonusLP;

  function upd(k, v) { setChar(p => ({ ...p, [k]: v })); }
  function tog(k, v) { setChar(p => ({ ...p, [k]: p[k].includes(v) ? p[k].filter(x => x !== v) : [...p[k], v] })); }

  // ── STEP CONTENT ───────────────────────────────────────────────────────────

  const STEPS = ["Identity", "Class", "Lineage", "Devotion", "Build", "Summary"];

  function Step0() {
    return (
      <div className="space-y-5">
        <p className="text-stone-400 text-sm">Who is your character before the mechanics?</p>
        <div>
          <label className="label">Character Name</label>
          <input className="input" value={char.name} onChange={e => upd("name", e.target.value)} placeholder="Name your character…" />
        </div>
        <div>
          <label className="label">Starting Level</label>
          <div className="flex flex-wrap gap-2">
            {LEVEL_TABLE.map(row => (
              <button key={row.level} onClick={() => upd("level", row.level)} className={`px-4 py-2 rounded text-sm border transition-colors ${char.level === row.level ? "bg-amber-700 border-amber-500 text-amber-100" : "bg-stone-800 border-stone-600 text-stone-300 hover:border-amber-600"}`}>
                Level {row.level}<span className="block text-xs opacity-60">{row.bp} BP base</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-stone-500 mt-1">Game 2 new players start at Level 4. Higher if joining later.</p>
        </div>
        <div>
          <label className="label">Civilization</label>
          <select className="input" value={char.civilization} onChange={e => upd("civilization", e.target.value)}>
            <option value="Auros">Auros — World of Seasons (default)</option>
            <option value="Empire of Light">Empire of Light</option>
            <option value="Unified Technarchy">Unified Technarchy</option>
            <option value="Astari">Astari — The Rampant Green</option>
            <option value="Shorn">The Shorn — Godhunters</option>
            <option value="Streams in Silver">Streams in Silver</option>
            <option value="Traveling Star">The Traveling Star</option>
            <option value="Unincorporated Lands">Unincorporated Lands</option>
          </select>
          {char.civilization !== "Auros" && <p className="text-xs text-amber-600 mt-1">⚠ Non-Aurosian characters require reading the "Main Camera" setting disclaimer and staff approval.</p>}
        </div>
        <div>
          <label className="label">Backstory <span className="text-stone-500 normal-case">(optional — approved backstories grant +2 BP)</span></label>
          <textarea className="input h-24 resize-none" value={char.backstory} onChange={e => upd("backstory", e.target.value)} placeholder="How did your character arrive? What drives them?…" />
          {backstoryBP > 0 && <p className="text-xs text-green-400 mt-1">✓ Backstory recorded — submit to plot team for +2 BP</p>}
        </div>
        <div className="bg-stone-800/50 rounded-lg p-3 border border-stone-700/50 text-xs space-y-1">
          <p className="text-stone-300 font-semibold mb-1">Starting Resources</p>
          <p className="text-stone-400">• <span className="text-amber-300 font-bold">{levelData.bp} BP</span> base · up to <span className="text-amber-300">+5</span> from Flaws · <span className="text-amber-300">+2</span> from approved backstory</p>
          <p className="text-stone-400">• <span className="text-amber-300 font-bold">{levelData.lp} LP</span> base Life Points</p>
          <p className="text-stone-400">• <span className="text-amber-300 font-bold">{levelData.spikes} Spikes</span></p>
          <p className="text-stone-400">• <span className="text-amber-300 font-bold">8 Wealth</span> starting gold</p>
        </div>
      </div>
    );
  }

  function Step1() {
    return (
      <div className="space-y-3">
        <p className="text-stone-400 text-sm">Your class determines your Powers and free Starting Skills. Level 4 = 4 levels in one class, or split across multiple.</p>
        {Object.entries(CLASSES).map(([name, cls]) => {
          const sel = char.selectedClass === name;
          return (
            <button key={name} onClick={() => upd("selectedClass", name)} className={`w-full text-left rounded-lg border p-4 transition-all ${sel ? "border-amber-500 bg-amber-900/20" : "border-stone-700 bg-stone-800/40 hover:border-stone-500"}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold text-amber-100">{name}</span>
                <div className="flex gap-1">
                  <Tag label={cls.type} color="gray" />
                  <Tag label={cls.role} color={cls.spellcaster ? "purple" : "teal"} />
                </div>
              </div>
              <p className="text-xs text-stone-400 mb-2">{cls.description}</p>
              {sel && (
                <div className="border-t border-stone-700/60 pt-3 space-y-3">
                  <div>
                    <p className="text-xs font-semibold text-amber-300 uppercase tracking-wider mb-1">Free Starting Skills</p>
                    {cls.startingSkills.map((s, i) => <p key={i} className="text-xs text-stone-300">✓ {s}</p>)}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-amber-300 uppercase tracking-wider mb-1">Key Features</p>
                    {cls.keyFeatures.map((f, i) => <p key={i} className="text-xs text-stone-300">◆ {f}</p>)}
                  </div>
                  {cls.note && <div className="bg-amber-900/20 border border-amber-800/40 rounded p-2 text-xs text-amber-200">⚠ {cls.note}</div>}
                </div>
              )}
            </button>
          );
        })}
        {char.selectedClass && (
          <div className="bg-stone-800/50 border border-stone-700 rounded-lg p-3">
            <p className="text-xs font-semibold text-stone-300 mb-1">Secondary Class (optional multiclass)</p>
            <p className="text-xs text-stone-500 mb-2">A 2nd class gives Multiclass Skills (not Starting Skills) and uses levels from your total 4.</p>
            <select className="input" value={char.secondaryClass} onChange={e => upd("secondaryClass", e.target.value)}>
              <option value="">— Single class —</option>
              {Object.keys(CLASSES).filter(c => c !== char.selectedClass).map(c => <option key={c} value={c}>{c} (MC skills: {CLASSES[c].multiclassSkills})</option>)}
            </select>
          </div>
        )}
      </div>
    );
  }

  function Step2() {
    return (
      <div className="space-y-3">
        <p className="text-stone-400 text-sm">Your lineage is your ancestry. Take Challenges (like flaws) to earn LBP, spend LBP on Advantages. Max 10 LBP earned.</p>
        {Object.entries(LINEAGES).map(([name, lin]) => {
          const sel = char.selectedLineage === name;
          const costColor = lin.costume.startsWith("Hard") ? "red" : lin.costume.startsWith("Medium") ? "amber" : "green";
          return (
            <button key={name} onClick={() => { upd("selectedLineage", name); upd("selectedSubLineage", ""); upd("selectedChallenges", []); upd("lbpAdvantages", []); }} className={`w-full text-left rounded-lg border p-4 transition-all ${sel ? "border-amber-500 bg-amber-900/20" : "border-stone-700 bg-stone-800/40 hover:border-stone-500"}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold text-amber-100">{name}</span>
                <Tag label={lin.costume.split(" —")[0]} color={costColor} />
              </div>
              <p className="text-xs text-stone-400 mb-1">{lin.description}</p>
              {sel && (
                <div className="border-t border-stone-700/60 pt-3 space-y-3" onClick={e => e.stopPropagation()}>
                  <div>
                    <p className="text-xs font-semibold text-amber-300 mb-1">Sub-Lineage</p>
                    <div className="flex flex-wrap gap-2">
                      {lin.sublineages.map(sl => (
                        <button key={sl} onClick={() => upd("selectedSubLineage", sl)} className={`text-xs px-3 py-1 rounded border ${char.selectedSubLineage === sl ? "bg-amber-800/50 border-amber-600 text-amber-200" : "bg-stone-800 border-stone-600 text-stone-300 hover:border-amber-600"}`}>{sl}</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-semibold text-red-300">Challenges (earn LBP)</p>
                      <span className="text-xs text-stone-400">{earnedLBP}/10 LBP earned</span>
                    </div>
                    <div className="space-y-1">
                      {lin.challenges.map(ch => {
                        const on = char.selectedChallenges.includes(ch.name);
                        return (
                          <button key={ch.name} onClick={() => tog("selectedChallenges", ch.name)} className={`w-full text-left text-xs rounded border px-3 py-2 ${on ? "bg-red-900/30 border-red-700/50 text-red-200" : "bg-stone-800/30 border-stone-700 text-stone-300 hover:border-red-700/40"}`}>
                            <span className="font-semibold">{ch.name}</span>{ch.lbp > 0 && <span className="ml-1 text-red-400">+{ch.lbp} LBP</span>} — <span className="text-stone-400">{ch.desc}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-semibold text-teal-300">Advantages (spend LBP)</p>
                      <span className={`text-xs ${spentLBP > earnedLBP ? "text-red-400" : "text-stone-400"}`}>{spentLBP}/{earnedLBP} LBP spent</span>
                    </div>
                    <div className="space-y-1">
                      {lin.advantages.map(adv => {
                        const on = char.lbpAdvantages.includes(adv.name);
                        const canAfford = on || spentLBP + adv.lbp <= earnedLBP;
                        return (
                          <button key={adv.name} onClick={() => canAfford && tog("lbpAdvantages", adv.name)} className={`w-full text-left text-xs rounded border px-3 py-2 ${on ? "bg-teal-900/30 border-teal-700/50 text-teal-200" : canAfford ? "bg-stone-800/30 border-stone-700 text-stone-300 hover:border-teal-700/40" : "bg-stone-800/20 border-stone-800 text-stone-600 cursor-not-allowed"}`}>
                            <span className="font-semibold">{adv.name}</span><span className="ml-1 text-teal-400">{adv.lbp} LBP</span> — <span className="text-stone-400">{adv.desc}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </button>
          );
        })}
      </div>
    );
  }

  function Step3() {
    return (
      <div className="space-y-3">
        <p className="text-stone-400 text-sm">Optional (required for Clerics). With Worship (1 BP), access up to 2 Divine Domains from your Devotion.</p>
        {char.selectedClass === "Cleric" && (
          <div className="bg-amber-900/20 border border-amber-700/40 rounded p-3 text-xs text-amber-200">⚠ <strong>Clerics must choose a Devotion</strong> — it powers Refreshing Prayer and your class identity.</div>
        )}
        <div className="space-y-2">
          {DEVOTIONS.map((dev, i) => {
            const sel = char.selectedDevotionIndex === i;
            return (
              <button key={dev.name} onClick={() => upd("selectedDevotionIndex", sel ? null : i)} className={`w-full text-left rounded-lg border p-3 transition-all ${sel ? "border-amber-500 bg-amber-900/20" : "border-stone-700 bg-stone-800/40 hover:border-stone-500"}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-amber-100 text-sm">{dev.name}</span>
                  <span className="text-xs text-stone-500">{dev.locality}</span>
                </div>
                <div className="flex flex-wrap gap-1 mb-1">
                  {dev.domains.length > 0 ? dev.domains.map(d => <Tag key={d} label={d} color="purple" />) : <span className="text-xs text-stone-500 italic">No divine domains</span>}
                </div>
                {sel && dev.tenets && <p className="text-xs text-stone-400 mt-1 italic border-t border-stone-700 pt-2">"{dev.tenets}"</p>}
                {sel && dev.color && <p className="text-xs text-stone-500 mt-1">Devotion color: {dev.color}</p>}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  function Step4() {
    const [skillSearch, setSkillSearch] = useState("");
    const [activeSkillCat, setActiveSkillCat] = useState("All");
    const [activePerkCat, setActivePerkCat] = useState("All");

    const filteredSkills = useMemo(() => ALL_SKILLS.filter(s => {
      const matchCat = activeSkillCat === "All" || s.cat === activeSkillCat;
      const matchSearch = !skillSearch || s.name.toLowerCase().includes(skillSearch.toLowerCase()) || s.desc.toLowerCase().includes(skillSearch.toLowerCase()) || (s.prereq && s.prereq.toLowerCase().includes(skillSearch.toLowerCase()));
      return matchCat && matchSearch;
    }), [skillSearch, activeSkillCat]);

    const filteredPerks = useMemo(() => ALL_PERKS.filter(p => activePerkCat === "All" || p.cat === activePerkCat), [activePerkCat]);

    return (
      <div className="space-y-4">
        {/* Live BP bar always visible */}
        <div className="sticky top-0 z-10 bg-stone-950/95 border border-stone-700/60 rounded-lg px-4 py-3 backdrop-blur">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-stone-400 uppercase tracking-wider">Build Points</span>
            <div className="flex gap-3 text-xs text-stone-500">
              <span>Base: <span className="text-amber-300">{levelData.bp}</span></span>
              {flawBP > 0 && <span>Flaws: <span className="text-green-400">+{flawBP}</span></span>}
              {backstoryBP > 0 && <span>Story: <span className="text-green-400">+{backstoryBP}</span></span>}
            </div>
          </div>
          <BPBar spent={totalSpent} total={totalBP} />
          <div className="flex justify-between text-xs mt-1 text-stone-500">
            <span>Skills: <span className="text-amber-200">{skillBPSpent} BP</span></span>
            <span>Perks: <span className="text-amber-200">{perkBPSpent} BP</span></span>
            <span className={remainingBP < 0 ? "text-red-400 font-bold" : "text-stone-400"}>Remaining: <span className="font-bold">{remainingBP}</span></span>
          </div>
        </div>

        {/* FLAWS */}
        <Accordion title="Flaws — earn up to 5 BP" icon="⚡" defaultOpen={true}>
          <p className="text-xs text-stone-500 mb-3">Max 5 BP awarded regardless of how many flaws you take. {flawBPRaw > 5 && <span className="text-amber-500">({flawBPRaw} BP earned, capped at 5)</span>}</p>
          {FLAW_CATS.map(cat => (
            <div key={cat} className="mb-3">
              <p className="text-xs uppercase tracking-widest text-stone-500 mb-2">{cat}</p>
              <div className="space-y-1">
                {ALL_FLAWS.filter(f => f.cat === cat).map(f => {
                  const on = char.selectedFlaws.includes(f.name);
                  return (
                    <button key={f.name} onClick={() => tog("selectedFlaws", f.name)} className={`w-full text-left text-xs rounded border px-3 py-2 transition-colors ${on ? "bg-red-900/30 border-red-700/50 text-red-200" : "bg-stone-800/30 border-stone-700 text-stone-300 hover:border-red-700/40"}`}>
                      <span className="font-semibold">{f.name}</span> <span className="text-red-400">+{f.bp} BP</span> — <span className="text-stone-400">{f.desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </Accordion>

        {/* SKILLS */}
        <Accordion title={`Skills — ${skillBPSpent} BP spent`} icon="⚔️" defaultOpen={true}>
          <p className="text-xs text-stone-500 mb-3">Note: Starting Skills from your Class are free — only purchase skills here that are NOT in your class's Starting Skills list.</p>
          <div className="mb-3">
            <input className="input mb-2" placeholder="Search skills…" value={skillSearch} onChange={e => setSkillSearch(e.target.value)} />
            <div className="flex flex-wrap gap-1">
              {["All", ...SKILL_CATS].map(cat => (
                <button key={cat} onClick={() => setActiveSkillCat(cat)} className={`text-xs px-2 py-1 rounded border transition-colors ${activeSkillCat === cat ? "bg-amber-800/50 border-amber-600 text-amber-200" : "bg-stone-800 border-stone-700 text-stone-400 hover:border-stone-500"}`}>{cat}</button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            {filteredSkills.map(s => {
              const on = char.selectedSkills.includes(s.name);
              const wouldOverBudget = !on && totalSpent + s.cost > totalBP;
              return (
                <button key={s.name} onClick={() => tog("selectedSkills", s.name)} className={`w-full text-left text-xs rounded border px-3 py-2 transition-colors ${on ? "bg-teal-900/30 border-teal-700/50 text-teal-200" : wouldOverBudget ? "bg-stone-800/20 border-stone-800 text-stone-500" : "bg-stone-800/30 border-stone-700 text-stone-300 hover:border-teal-700/40"}`}>
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="font-semibold">{s.name}</span>
                      {s.ranks && <span className="ml-1 text-stone-500">(×{s.ranks})</span>}
                      {on && <span className="ml-2 text-teal-400">✓</span>}
                    </div>
                    <span className={`shrink-0 ml-2 font-bold ${on ? "text-teal-300" : wouldOverBudget ? "text-stone-600" : "text-amber-400"}`}>{s.cost} BP</span>
                  </div>
                  {s.prereq && <p className="text-stone-500 mt-0.5">Req: {s.prereq}</p>}
                  <p className="text-stone-400 mt-0.5">{s.desc}</p>
                </button>
              );
            })}
            {filteredSkills.length === 0 && <p className="text-stone-500 text-xs italic">No skills match.</p>}
          </div>
        </Accordion>

        {/* PERKS */}
        <Accordion title={`Perks — ${perkBPSpent} BP spent`} icon="✦" defaultOpen={false}>
          <div className="flex flex-wrap gap-1 mb-3">
            {["All", ...PERK_CATS].map(cat => (
              <button key={cat} onClick={() => setActivePerkCat(cat)} className={`text-xs px-2 py-1 rounded border transition-colors ${activePerkCat === cat ? "bg-amber-800/50 border-amber-600 text-amber-200" : "bg-stone-800 border-stone-700 text-stone-400 hover:border-stone-500"}`}>{cat}</button>
            ))}
          </div>
          <div className="space-y-1">
            {filteredPerks.map(p => {
              const on = char.selectedPerks.includes(p.name);
              const wouldOverBudget = !on && totalSpent + p.cost > totalBP;
              return (
                <button key={p.name} onClick={() => tog("selectedPerks", p.name)} className={`w-full text-left text-xs rounded border px-3 py-2 transition-colors ${on ? "bg-teal-900/30 border-teal-700/50 text-teal-200" : wouldOverBudget ? "bg-stone-800/20 border-stone-800 text-stone-500" : "bg-stone-800/30 border-stone-700 text-stone-300 hover:border-teal-700/40"}`}>
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="font-semibold">{p.name}</span>
                      {p.ranks && <span className="ml-1 text-stone-500">(×{p.ranks})</span>}
                      {on && <span className="ml-2 text-teal-400">✓</span>}
                    </div>
                    <span className={`shrink-0 ml-2 font-bold ${on ? "text-teal-300" : wouldOverBudget ? "text-stone-600" : "text-amber-400"}`}>{p.cost} BP</span>
                  </div>
                  {p.prereq && <p className="text-stone-500 mt-0.5">Req: {p.prereq}</p>}
                  <p className="text-stone-400 mt-0.5">{p.desc}</p>
                </button>
              );
            })}
          </div>
        </Accordion>
      </div>
    );
  }

  function Step5() {
    const devObj = char.selectedDevotionIndex !== null ? DEVOTIONS[char.selectedDevotionIndex] : null;
    return (
      <div className="space-y-4">
        {/* Header */}
        <div className="bg-gradient-to-br from-amber-900/30 to-stone-900 border border-amber-700/40 rounded-xl p-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h2 className="text-2xl font-bold text-amber-100" style={{ fontFamily: "'Cinzel', serif" }}>{char.name || "Unnamed"}</h2>
              <p className="text-stone-400 text-sm">{char.civilization} · Level {char.level} {char.selectedClass}{char.secondaryClass ? " / " + char.secondaryClass : ""}</p>
            </div>
            <div className={`text-right text-sm font-bold ${remainingBP < 0 ? "text-red-400" : "text-amber-300"}`}>
              <span>{totalSpent}/{totalBP} BP</span>
              <span className="block text-xs font-normal text-stone-500">{remainingBP >= 0 ? `${remainingBP} remaining` : `${-remainingBP} over budget`}</span>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-2 mb-3">
            {[{ label: "Life Points", val: totalLP, icon: "❤️" }, { label: "Spikes", val: levelData.spikes, icon: "⚡" }, { label: "Wealth", val: "8g", icon: "💰" }].map(s => (
              <div key={s.label} className="bg-stone-800/60 rounded p-2 text-center border border-stone-700">
                <div>{s.icon}</div>
                <div className="text-lg font-bold text-amber-100">{s.val}</div>
                <div className="text-xs text-stone-400">{s.label}</div>
              </div>
            ))}
          </div>
          <BPBar spent={totalSpent} total={totalBP} />
        </div>

        {/* Class */}
        {char.selectedClass && (
          <Accordion title="Class" icon="⚔️" defaultOpen={true}>
            <p className="font-bold text-amber-100 mb-1">{char.selectedClass}{char.secondaryClass ? " / " + char.secondaryClass : ""}</p>
            {CLASSES[char.selectedClass].startingSkills.map((s, i) => <p key={i} className="text-xs text-stone-300">✓ {s}</p>)}
            {char.secondaryClass && <p className="text-xs text-stone-400 mt-1">MC skills: {CLASSES[char.secondaryClass].multiclassSkills}</p>}
          </Accordion>
        )}

        {/* Lineage */}
        {char.selectedLineage && (
          <Accordion title="Lineage" icon="🧬" defaultOpen={true}>
            <div className="flex items-center gap-2 mb-2">
              <span className="font-bold text-amber-100">{char.selectedLineage}</span>
              {char.selectedSubLineage && <Tag label={char.selectedSubLineage} color="blue" />}
            </div>
            {char.selectedChallenges.length > 0 && (
              <div className="mb-2">
                <p className="text-xs text-stone-400 mb-1">Challenges ({earnedLBP} LBP earned):</p>
                {char.selectedChallenges.map(c => <p key={c} className="text-xs text-red-300">⚠ {c}</p>)}
              </div>
            )}
            {char.lbpAdvantages.length > 0 && (
              <div>
                <p className="text-xs text-stone-400 mb-1">Advantages ({spentLBP}/{earnedLBP} LBP):</p>
                {char.lbpAdvantages.map(a => <p key={a} className="text-xs text-teal-300">✦ {a}</p>)}
              </div>
            )}
          </Accordion>
        )}

        {/* Devotion */}
        {devObj && (
          <Accordion title="Devotion" icon="🌟" defaultOpen={true}>
            <p className="font-bold text-amber-100">{devObj.name}</p>
            <div className="flex flex-wrap gap-1 mt-1 mb-1">{devObj.domains.map(d => <Tag key={d} label={d} color="purple" />)}</div>
            {devObj.tenets && <p className="text-xs text-stone-400 italic">"{devObj.tenets}"</p>}
          </Accordion>
        )}

        {/* Skills purchased */}
        {char.selectedSkills.length > 0 && (
          <Accordion title={`Purchased Skills — ${skillBPSpent} BP`} icon="📚" defaultOpen={true}>
            <div className="space-y-1">
              {char.selectedSkills.map(n => {
                const s = ALL_SKILLS.find(x => x.name === n);
                return <div key={n} className="flex justify-between text-xs"><span className="text-teal-300">{n}</span><span className="text-amber-400">{s?.cost} BP</span></div>;
              })}
            </div>
          </Accordion>
        )}

        {/* Perks purchased */}
        {char.selectedPerks.length > 0 && (
          <Accordion title={`Purchased Perks — ${perkBPSpent} BP`} icon="✦" defaultOpen={true}>
            <div className="space-y-1">
              {char.selectedPerks.map(n => {
                const p = ALL_PERKS.find(x => x.name === n);
                return <div key={n} className="flex justify-between text-xs"><span className="text-teal-300">{n}</span><span className="text-amber-400">{p?.cost} BP</span></div>;
              })}
            </div>
          </Accordion>
        )}

        {/* Flaws */}
        {char.selectedFlaws.length > 0 && (
          <Accordion title={`Flaws — +${flawBP} BP earned`} icon="⚡" defaultOpen={true}>
            <div className="space-y-1">
              {char.selectedFlaws.map(n => {
                const f = ALL_FLAWS.find(x => x.name === n);
                return <div key={n} className="flex justify-between text-xs"><span className="text-red-300">{n}</span><span className="text-red-400">+{f?.bp} BP</span></div>;
              })}
              {flawBPRaw > 5 && <p className="text-xs text-amber-500 mt-1">({flawBPRaw} BP earned, capped at 5)</p>}
            </div>
          </Accordion>
        )}

        {/* BP Summary */}
        <Accordion title="BP Breakdown" icon="📊" defaultOpen={true}>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between"><span className="text-stone-400">Base (Level {char.level})</span><span className="text-amber-300">{levelData.bp}</span></div>
            {flawBP > 0 && <div className="flex justify-between"><span className="text-stone-400">Flaws</span><span className="text-green-400">+{flawBP}</span></div>}
            {backstoryBP > 0 && <div className="flex justify-between"><span className="text-stone-400">Backstory (pending approval)</span><span className="text-green-400">+{backstoryBP}</span></div>}
            <div className="flex justify-between font-bold border-t border-stone-700 pt-1"><span className="text-stone-300">Total Available</span><span className="text-amber-200">{totalBP}</span></div>
            {skillBPSpent > 0 && <div className="flex justify-between"><span className="text-stone-400">Skills spent</span><span className="text-red-400">−{skillBPSpent}</span></div>}
            {perkBPSpent > 0 && <div className="flex justify-between"><span className="text-stone-400">Perks spent</span><span className="text-red-400">−{perkBPSpent}</span></div>}
            <div className={`flex justify-between font-bold border-t border-stone-700 pt-1 ${remainingBP < 0 ? "text-red-400" : "text-amber-100"}`}>
              <span>Remaining</span><span>{remainingBP} BP</span>
            </div>
          </div>
        </Accordion>

        {/* Next steps */}
        <div className="bg-amber-900/20 border border-amber-700/40 rounded-lg p-3 text-xs text-amber-200 space-y-1">
          <p className="font-semibold mb-1">Next Steps</p>
          <p>1. Purchase remaining skills you want with your {remainingBP} remaining BP</p>
          <p>2. Submit to plot via the Character Submission Form on the website</p>
          {char.backstory.trim().length > 20 && <p>3. Include backstory for staff approval (+2 BP if approved)</p>}
          <p>{char.backstory.trim().length > 20 ? "4" : "3"}. Collect your starting 8 Wealth and any mundane equipment you phys-rep</p>
        </div>
      </div>
    );
  }

  const stepFns = [Step0, Step1, Step2, Step3, Step4, Step5];
  const CurrentStep = stepFns[step];

  return (
    <div style={{ fontFamily: "'EB Garamond', 'Palatino Linotype', Georgia, serif", background: "linear-gradient(135deg, #1a1410 0%, #0f0e0c 50%, #16140f 100%)", minHeight: "100vh", color: "#e8dcc8" }} className="p-4">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=EB+Garamond:ital,wght@0,400;0,500;1,400&display=swap');
        * { box-sizing: border-box; }
        .label { display: block; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.1em; color: #78716c; margin-bottom: 0.25rem; }
        .input { width: 100%; background: #292524; border: 1px solid #57534e; border-radius: 0.375rem; padding: 0.5rem 0.75rem; color: #fde68a; font-size: 0.875rem; outline: none; font-family: inherit; }
        .input:focus { border-color: #d97706; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: #1a1410; } ::-webkit-scrollbar-thumb { background: #6b5a3e; border-radius: 3px; }
      `}</style>
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-5">
          <h1 style={{ fontFamily: "'Cinzel', serif", letterSpacing: "0.15em" }} className="text-3xl font-bold text-amber-200">Wellspring</h1>
          <p className="text-stone-500 text-xs tracking-widest uppercase mt-0.5">Character Creation</p>
          <div className="w-20 h-px bg-amber-700/40 mx-auto mt-2" />
        </div>

        {/* Step Nav */}
        <div className="flex gap-1 mb-5 overflow-x-auto pb-1">
          {STEPS.map((s, i) => (
            <button key={i} onClick={() => setStep(i)} className={`flex-1 min-w-0 text-center py-2 px-1 rounded text-xs transition-all border ${i === step ? "bg-amber-800/50 border-amber-600 text-amber-200 font-semibold" : i < step ? "bg-stone-800/50 border-stone-700 text-stone-400" : "bg-stone-900/30 border-stone-800 text-stone-600"}`}>
              <span className="block opacity-60">{i + 1}</span>
              <span className="block truncate leading-tight">{s}</span>
            </button>
          ))}
        </div>

        {/* Step Content */}
        <div className="mb-5">
          <CurrentStep />
        </div>

        {/* Nav */}
        <div className="flex items-center justify-between border-t border-stone-800 pt-4">
          <button onClick={() => setStep(s => Math.max(0, s - 1))} disabled={step === 0} className="px-5 py-2 rounded border border-stone-700 text-stone-300 text-sm hover:border-stone-500 disabled:opacity-30 disabled:cursor-not-allowed">← Back</button>
          <div className="flex items-center gap-3">
            <span className={`text-sm font-bold ${remainingBP < 0 ? "text-red-400" : "text-amber-300"}`}>{totalSpent}/{totalBP} BP</span>
            {step < STEPS.length - 1 && (
              <button onClick={() => setStep(s => Math.min(STEPS.length - 1, s + 1))} className="px-5 py-2 rounded border border-amber-700 bg-amber-900/30 text-amber-200 text-sm hover:bg-amber-900/50">Next →</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
