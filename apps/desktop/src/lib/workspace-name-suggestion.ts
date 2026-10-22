import { allWorkspaces } from '@/session-store'

// Orca's generated workspace names (shared/worktree-name-suggestion.ts, marine-creature-names-primary.ts):
// a blank name becomes an unused sea creature, picked at random, then `name-2`, `name-3`… once all are taken.

const MARINE_CREATURES = [
  'Nautilus', 'Seahorse', 'Starfish', 'Coral', 'Narwhal', 'Jellyfish', 'Octopus', 'Manta', 'Dolphin',
  'Manatee', 'Cuttlefish', 'Anemone', 'Urchin', 'Triton', 'Nudibranch', 'Coelacanth', 'Oarfish', 'Beluga',
  'Dugong', 'Porpoise', 'Stingray', 'Hammerhead', 'Wobbegong', 'Sawfish', 'Chimaera', 'Anglerfish',
  'Viperfish', 'Dragonfish', 'Axolotl', 'Otter', 'Seadragon', 'Seahare', 'Squid', 'Argonaut', 'Sponge',
  'Barnacle', 'Cowrie', 'Guitarfish', 'Lamprey', 'Isopod', 'Lionfish', 'Clownfish', 'Angelfish',
  'Butterflyfish', 'Parrotfish', 'Pufferfish', 'Moonfish', 'Firefish', 'Unicornfish', 'Rainbowfish', 'Betta',
  'Discus', 'Arowana', 'Koi', 'Piranha', 'Barracuda', 'Moray', 'Sunfish', 'Lanternfish', 'Archerfish',
  'Mudskipper', 'Hatchetfish', 'Knifefish', 'Leaffish', 'Glassfish', 'Ropefish', 'Bichir', 'Tigerfish',
  'Cardinalfish', 'Lungfish', 'Opah', 'Frogfish', 'Stonefish', 'Cutlassfish', 'Paddlefish', 'Arapaima',
  'Mandarin', 'Blobfish', 'Thresher', 'Vaquita', 'Pipefish', 'Guppy', 'Tetra', 'Danio', 'Cichlid', 'Oscar',
  'Gourami', 'Killifish', 'Rasbora', 'Pleco', 'Goldfish', 'Molly', 'Platy', 'Barb', 'Loach', 'Medaka',
  'Pacu', 'Filefish', 'Boxfish', 'Cowfish', 'Surgeonfish', 'Damselfish', 'Wrasse', 'Goby', 'Blenny',
  'Conger', 'Sculpin', 'Darter', 'Remora', 'Pilotfish', 'Trumpetfish', 'Cornetfish', 'Jawfish', 'Toadfish',
  'Pearlfish', 'Driftfish', 'Lumpfish', 'Snailfish', 'Stickleback', 'Halfbeak', 'Snipefish', 'Pencilfish',
  'Snakehead', 'Tripletail', 'Lookdown', 'Sweetlips', 'Squirrelfish', 'Soldierfish', 'Rabbitfish',
  'Hawkfish', 'Bannerfish', 'Batfish', 'Chromis', 'Anthias', 'Fusilier', 'Sweeper', 'Emperor', 'Ponyfish',
  'Kelpfish', 'Weever', 'Pearlside', 'Opaleye', 'Ballyhoo', 'Needlefish', 'Triggerfish', 'Gar', 'Tarpon',
  'Sailfish', 'Conch', 'Walrus', 'Seal', 'Penguin', 'Hagfish', 'Gulper', 'Hydra', 'Krill', 'Salp',
  'Tunicate', 'Crinoid', 'Polyp', 'Limpet', 'Whelk', 'Bowfin', 'Minnow', 'Gudgeon', 'Goldeye', 'Mooneye',
  'Soapfish', 'Leatherjacket', 'Rudderfish', 'Sabrefish', 'Puffin', 'Albatross', 'Osprey', 'Pelican',
  'Petrel', 'Gannet', 'Tern', 'Cormorant', 'Leatherback', 'Hawksbill', 'Loggerhead', 'Dottyback', 'Basslet',
  'Gramma', 'Hamlet', 'Hogfish', 'Dartfish', 'Foxface', 'Shrimpfish', 'Pyrosome', 'Seapen', 'Medusa',
  'Candlefish', 'Silverside', 'Shiner', 'Eelpout', 'Madtom', 'Shovelnose', 'Sandlance', 'Tubesnout',
  'Marlin', 'Bonefish', 'Dace', 'Rudd', 'Spirula', 'Permit', 'Grunt', 'Trevally', 'Croaker', 'Drum',
  'Ladyfish', 'Bullhead', 'Torpedo', 'Skate', 'Hermit', 'Fiddler', 'Fireworm', 'Tubeworm', 'Amphipod',
  'Copepod', 'Pteropod', 'Seaslug', 'Swordtail', 'Bluegill', 'Pickerel', 'Redhorse', 'Logperch', 'Goblin',
  'Catshark', 'Harlequin', 'Murex', 'Volute', 'Wentletrap', 'Nerite', 'Stargazer', 'Handfish', 'Flyingfish',
  'Waspfish', 'Skua', 'Shearwater', 'Guillemot', 'Razorbill', 'Auk', 'Fulmar', 'Murre', 'Velvetfish',
  'Prowfish', 'Sandperch', 'Bobtail', 'Chiton', 'Featherstar', 'Nereid', 'Siren', 'Kraken', 'Selkie',
  'Leviathan', 'Wolffish', 'Wreckfish', 'Horseshoe', 'Orca', 'Cachalot', 'Rorqual', 'Grampus', 'Humpback',
  'Bowhead', 'Finback', 'Sealion', 'Pinniped', 'Cetacean', 'Mako', 'Porbeagle', 'Dogfish', 'Spurdog', 'Tope',
  'Bonnethead'
] as const

function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  return trimmed.slice(Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\')) + 1)
}

/** Unused across every host's workspaces (by folder name, as Orca dedupes), so sidebar names stay distinct. */
export function suggestWorkspaceName(random: () => number = Math.random): string {
  const used = new Set(allWorkspaces().flatMap((w) => [basename(w.path).toLowerCase(), w.name.toLowerCase()]))
  for (let tier = 1; ; tier++) {
    const available = MARINE_CREATURES.map((n) => (tier === 1 ? n.toLowerCase() : `${n.toLowerCase()}-${tier}`)).filter((n) => !used.has(n))
    if (available.length > 0) return available[Math.floor(random() * available.length)]!
  }
}
