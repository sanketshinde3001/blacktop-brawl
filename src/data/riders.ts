/**
 * The 14 rival rashers. Each uses one of the generated sprite designs (riders/<design>/*)
 * optionally hue-shifted so riders sharing a design still look different.
 *   skill      0..1  how fast they ride within the level's speed band
 *   aggression 0..1  how often they pick fights
 *   toughness  0..1  how much punishment before they fall
 *   club       0..1  chance of starting a race armed
 */

export interface RiderDef {
  id: string;
  name: string;
  design: string;
  hue: number;
  skill: number;
  aggression: number;
  toughness: number;
  club: number;
  /** pre-race trash talk */
  talk: string[];
  /** said when they beat you */
  gloat: string[];
  /** said when you beat them */
  sore: string[];
}

export const RIDERS: RiderDef[] = [
  {
    id: 'mongo', name: 'Mongo', design: 'brawler', hue: 0, skill: 0.62, aggression: 0.95, toughness: 1.0, club: 0.55,
    talk: ["Mongo don't race. Mongo smash. Racing just happens on the way.", "I'm gonna fold you up and mail you home, rookie."],
    gloat: ['Mongo win. You go cry now.'], sore: ['Next time Mongo use bigger stick.'],
  },
  {
    id: 'tanya', name: 'Tanya', design: 'racer', hue: 0, skill: 0.95, aggression: 0.35, toughness: 0.55, club: 0.05,
    talk: ["You'll be staring at my tail light all day, sweetheart.", "I didn't come here to fight. I came here to win. Try and keep up."],
    gloat: ['Was that your top speed? Cute.'], sore: ['Lucky run. Enjoy it while it lasts.'],
  },
  {
    id: 'razor', name: 'Razor', design: 'punk', hue: 0, skill: 0.7, aggression: 0.85, toughness: 0.6, club: 0.5,
    talk: ['Rules are for suckers. See you on the asphalt... face first.', "I've got a chain, a grudge and nothing to lose."],
    gloat: ['Gravel burn looks good on you!'], sore: ['This ain\'t over, poser.'],
  },
  {
    id: 'tank', name: 'Tank', design: 'brawler', hue: 150, skill: 0.55, aggression: 0.8, toughness: 1.0, club: 0.4,
    talk: ["They call me Tank 'cause nothing stops me. Especially not you.", 'Get in my way and you become a speed bump.'],
    gloat: ['Flattened. Just like I said.'], sore: ["Didn't even feel it."],
  },
  {
    id: 'dixie', name: 'Dixie', design: 'bomber', hue: 0, skill: 0.78, aggression: 0.6, toughness: 0.7, club: 0.3,
    talk: ["Honey, I've been rashin' since before you had training wheels.", "Bless your heart, you think you can win."],
    gloat: ['Better luck next time, sugar.'], sore: ["Well, butter my biscuit. Nice ridin'."],
  },
  {
    id: 'jet', name: 'Jet', design: 'yellow', hue: 0, skill: 0.9, aggression: 0.3, toughness: 0.5, club: 0.05,
    talk: ["Speed is a gift. I've got it. You don't.", "I'll be at the finish line signing autographs by the time you show up."],
    gloat: ['Too fast, too cool, too bad for you.'], sore: ['My bike was acting up. Obviously.'],
  },
  {
    id: 'blaze', name: 'Blaze', design: 'rebel', hue: 0, skill: 0.8, aggression: 0.55, toughness: 0.65, club: 0.2,
    talk: ["Hot out here, huh? Wait till I light you up on the downhill.", "I burn through tires and rookies at the same rate."],
    gloat: ['Toasted!'], sore: ['You got lucky. The road was cold.'],
  },
  {
    id: 'grinder', name: 'Grinder', design: 'punk', hue: 190, skill: 0.6, aggression: 0.9, toughness: 0.55, club: 0.6,
    talk: ["Heh heh... I like the sound bones make on the pavement.", "Ride next to me. I dare ya. Heh heh heh."],
    gloat: ['Heh heh... you broke good.'], sore: ['Heh... next time... next time.'],
  },
  {
    id: 'krystal', name: 'Krystal', design: 'racer', hue: 200, skill: 0.88, aggression: 0.45, toughness: 0.6, club: 0.1,
    talk: ['I calculated every corner of this road. You are not a factor.', "Stay out of my line and nobody gets hurt."],
    gloat: ['As predicted.'], sore: ['Interesting. I will adjust.'],
  },
  {
    id: 'buzz', name: 'Buzz', design: 'yellow', hue: 90, skill: 0.72, aggression: 0.65, toughness: 0.8, club: 0.25,
    talk: ['Ten-hut, maggot! This road is a war zone and you are the enemy.', 'I eat rookies for breakfast. Hoo-rah!'],
    gloat: ['Mission accomplished!'], sore: ['Tactical retreat. I will return.'],
  },
  {
    id: 'knuckles', name: 'Knuckles', design: 'bomber', hue: 120, skill: 0.66, aggression: 0.75, toughness: 0.9, club: 0.45,
    talk: ["Forty years on the road, kid. I've buried tougher than you.", "Old don't mean slow. Old means mean."],
    gloat: ['Respect your elders, punk.'], sore: ['Hmph. Kids these days.'],
  },
  {
    id: 'roxy', name: 'Roxy', design: 'rebel', hue: 220, skill: 0.84, aggression: 0.6, toughness: 0.6, club: 0.25,
    talk: ["Don't let the lipstick fool you. I bite.", "Last guy who cut me off is still picking gravel out of his teeth."],
    gloat: ['Ciao, loser!'], sore: ["Hey, not bad. For a rookie."],
  },
  {
    id: 'deacon', name: 'Deacon', design: 'brawler', hue: 290, skill: 0.74, aggression: 0.7, toughness: 0.85, club: 0.5,
    talk: ['The road giveth, and the road taketh away. Today it taketh you.', 'Say your prayers, son. The Deacon is riding.'],
    gloat: ['Judgement has been served.'], sore: ['The Lord works in mysterious ways.'],
  },
  {
    id: 'snake', name: 'Snake', design: 'punk', hue: 300, skill: 0.82, aggression: 0.7, toughness: 0.55, club: 0.35,
    talk: ["Relax, friend. I'll just ride beside you. Real close. Sssso close.", "I never hit anyone first. I just hit 'em last."],
    gloat: ['Too ssslow.'], sore: ["You'll pay for that one."],
  },
];

export function riderById(id: string): RiderDef | undefined {
  return RIDERS.find((r) => r.id === id);
}
