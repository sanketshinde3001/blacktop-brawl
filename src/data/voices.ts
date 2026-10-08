/**
 * Voice lines. If an audio file exists for a line it is played; otherwise the line is spoken by the
 * player's own device (Web Speech API), so nothing has to be recorded or shipped.
 */
import { GAME_TITLE } from '../config';

export interface VoiceLine {
  text: string;
  /** 0..2, lower = gruffer */
  pitch: number;
  /** 0.1..10, 1 = normal */
  rate: number;
}

export const VOICE_LINES: Record<string, VoiceLine> = {
  'voice/title': { text: `${GAME_TITLE.toLowerCase()}!`, pitch: 0.6, rate: 0.9 },
  'voice/go': { text: 'Go!', pitch: 0.7, rate: 1.1 },
  'voice/pullover': { text: 'Pull over, punk!', pitch: 0.5, rate: 1.05 },
  'voice/busted': { text: "You're busted! That's gonna cost ya.", pitch: 0.5, rate: 1 },
  'voice/wrecked': { text: "Whoa. That bike's totaled.", pitch: 0.7, rate: 0.9 },
  'voice/winner': { text: 'Winner!', pitch: 0.8, rate: 1 },
  'voice/qualified': { text: 'You qualified!', pitch: 0.8, rate: 1.05 },
  'voice/notqualified': { text: "You didn't qualify. Try again.", pitch: 0.7, rate: 1 },
  'voice/levelup': { text: 'Next level!', pitch: 0.8, rate: 1.05 },
  'voice/gameover': { text: 'Game over.', pitch: 0.4, rate: 0.8 },
  'voice/champion': { text: 'You are the champion!', pitch: 0.8, rate: 1 },
};
