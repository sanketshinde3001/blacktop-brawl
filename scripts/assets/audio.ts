/**
 * Audio asset manifest.
 *   music  -> Lyria 3.5 full tracks (loop in game)
 *   jingle -> Lyria clip model, trimmed to `seconds` with a fade-out
 *   sfx    -> omni model clip; the soundtrack is extracted, silence-trimmed and peak-normalised
 *   voice  -> Gemini TTS
 * Output: public/assets/audio/<id>.mp3 (sfx are .wav so loops are gapless)
 * Voice lines are plain text: this TTS model speaks any stage directions aloud, so the delivery
 * comes from the voice choice and punctuation.
 */

export type AudioAsset =
  | { id: string; type: 'music'; prompt: string }
  | { id: string; type: 'jingle'; prompt: string; seconds: number }
  | { id: string; type: 'sfx'; prompt: string; what: string; seconds: number; loop?: boolean }
  | { id: string; type: 'voice'; text: string; voice: string };

const NO_VOCALS = 'Instrumental only, absolutely no vocals or singing.';

const music = (id: string, prompt: string): AudioAsset => ({ id: `music/${id}`, type: 'music', prompt: `${prompt} ${NO_VOCALS}` });
const jingle = (id: string, seconds: number, prompt: string): AudioAsset => ({
  id: `music/${id}`,
  type: 'jingle',
  seconds,
  prompt: `${prompt} It starts immediately with no intro. ${NO_VOCALS}`,
});
const sfx = (id: string, seconds: number, what: string, loop = false): AudioAsset => ({
  id: `sfx/${id}`,
  type: 'sfx',
  seconds,
  loop,
  prompt: `Generate a sound effect: ${what}. About ${Math.max(1, Math.round(seconds))} seconds long. No music, no speech, no background ambience; clean studio-quality foley.`,
  what,
});
const voice = (id: string, voiceName: string, text: string): AudioAsset => ({ id: `voice/${id}`, type: 'voice', voice: voiceName, text });

export const AUDIO_ASSETS: AudioAsset[] = [
  // --- music ---------------------------------------------------------------------------
  music('title', 'Gritty early-1990s hard rock anthem for the title screen of a motorcycle combat racing video game: crunchy overdriven guitar riff, pounding drums, driving bass, lots of attitude.'),
  music('menu', 'Laid-back bluesy biker rock groove for a video game menu and motorcycle shop: slide guitar, mid-tempo shuffle, smoky roadhouse vibe.'),
  music('race_sierra', 'Fast heavy metal track for a mountain motorcycle race in a 1990s video game: galloping palm-muted riff, double bass drums, soaring guitar leads.'),
  music('race_pacific', 'High-energy surf punk rock track for a coastal highway motorcycle race in a 1990s video game: reverb-drenched twangy guitars, very fast drums.'),
  music('race_redwood', 'Driving grunge rock track for a forest motorcycle race in a 1990s video game: heavy fuzzy distorted guitars, dark brooding mood, powerful drums.'),
  music('race_desert', 'Heavy desert stoner rock track for a desert motorcycle race in a 1990s video game: hypnotic fuzz guitar riff, big thumping drums, hot and dusty.'),
  music('race_grass', 'Upbeat southern rock track for a countryside motorcycle race in a 1990s video game: twin guitar harmonies, boogie rhythm, rollicking piano.'),
  music('ending', 'Epic celebratory rock anthem for the ending credits of a 1990s motorcycle racing video game: triumphant guitar melody, big drums, uplifting.'),
  jingle('win', 7, 'Short triumphant hard rock victory fanfare: guitar and drums, ending on a big sustained power chord.'),
  jingle('lose', 6, 'Short sad bluesy guitar sting of defeat: slow descending notes, ending on a low chord.'),
  jingle('busted', 6, 'Short ominous comedic rock sting: three heavy descending "dun dun dun" guitar hits with a cymbal crash.'),
  jingle('levelup', 8, 'Short exciting rock fanfare announcing the next level: rising guitar riff, drum fill, big final chord.'),
  jingle('gameover', 8, 'Short dark rock sting for game over: slow heavy guitar chords fading out.'),

  // --- sound effects -------------------------------------------------------------------
  sfx('punch', 1.2, 'a single hard punch impact, a fist hitting a leather jacket, a meaty thud'),
  sfx('kick', 1.2, 'a single heavy boot kick slamming into a person, a deep thump with leather creak'),
  sfx('club', 1.2, 'a single hard wooden club smacking a motorcycle helmet, a loud sharp crack'),
  sfx('crash', 2.5, 'a motorcycle crashing and sliding on asphalt: metal scraping, plastic cracking, parts bouncing'),
  sfx('carCrash', 2.5, 'a motorcycle slamming into a car at high speed: a loud metal crunch and breaking glass'),
  sfx('thud', 1.0, 'a person landing hard on asphalt after being thrown: a heavy body thud'),
  sfx('screech', 1.6, 'car tyres skidding and screeching on asphalt'),
  sfx('horn', 1.4, 'an angry 1980s car horn honking twice'),
  sfx('truckHorn', 1.8, 'a big semi-truck air horn blast'),
  sfx('siren', 3.0, 'a police motorcycle siren wailing continuously', true),
  sfx('crowd', 3.0, 'a crowd of rowdy race fans cheering and whistling', true),
  sfx('whoosh', 1.2, 'a car passing by very fast, a doppler whoosh'),
  sfx('cash', 1.2, 'an old mechanical cash register ka-ching'),
  sfx('grunt', 0.8, 'a man grunting in pain after being punched, a short "oof"'),
  sfx('yell', 1.2, 'a man yelling in pain as he falls, a short "aaargh"'),
  sfx('grab', 0.8, 'a quick swish of a hand snatching a wooden stick'),
  sfx('gravel', 3.0, 'a motorcycle riding over rough gravel and dirt: a rumbling crunch', true),

  // --- voice ---------------------------------------------------------------------------
  voice('title', 'Fenrir', 'Blacktop Brawl!'),
  voice('go', 'Fenrir', 'Go!'),
  voice('pullover', 'Algenib', 'Pull over, punk!'),
  voice('busted', 'Algenib', "You're busted! That's gonna cost ya."),
  voice('wrecked', 'Charon', "Whoa... that bike's totaled."),
  voice('winner', 'Fenrir', 'Winner!'),
  voice('qualified', 'Fenrir', 'You qualified!'),
  voice('notqualified', 'Charon', "You didn't qualify. Try again."),
  voice('levelup', 'Fenrir', 'Next level!'),
  voice('gameover', 'Charon', 'Game over.'),
  voice('champion', 'Fenrir', 'You are the champion!'),
];
