const WORDS = `otter badger falcon heron lynx moose panda koala gecko bison robin finch wren raven tiger zebra
llama lemur newt seal whale shark crab squid trout salmon beaver ferret marmot walrus parrot puffin toucan
condor osprey magpie sparrow swallow pelican cobra iguana turtle rabbit hamster donkey camel yak eagle goose
penguin dolphin gopher jaguar cougar coyote weasel mongoose gazelle antelope buffalo cheetah leopard panther
maple cedar birch aspen willow spruce hazel alder elm oak juniper cypress sequoia redwood walnut chestnut
poplar laurel magnolia hickory linden sycamore olive acacia banyan mango cherry apple peach plum lemon lime
orange fig river canyon meadow harbor glacier summit valley prairie island lagoon desert forest thunder
breeze ember frost comet orbit nebula aurora cosmos quartz copper silver amber coral indigo scarlet violet
saffron cobalt crimson ivory jade onyx pebble marble granite cinder flint topaz ruby opal pepper ginger
cinnamon basil mint sage thyme clover daisy tulip orchid lotus poppy jasmine lily`
  .split(/\s+/)
  .filter(Boolean);

export const SESSION_WORDS: readonly string[] = [...new Set(WORDS)];

export function pickName(used: Iterable<string>, random: () => number = Math.random): string {
  const taken = new Set(used);
  const free = SESSION_WORDS.filter((w) => !taken.has(w));
  if (free.length > 0) return free[Math.floor(random() * free.length)] as string;
  const word = SESSION_WORDS[Math.floor(random() * SESSION_WORDS.length)] as string;
  for (let n = 2; ; n++) {
    if (!taken.has(`${word}${n}`)) return `${word}${n}`;
  }
}
