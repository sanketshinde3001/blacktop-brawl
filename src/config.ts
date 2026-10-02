/**
 * Global tuning knobs. Everything that affects feel lives here so it can be tweaked in one place.
 * World units: the road is 2 * ROAD_WIDTH wide; 1 mph == MPH units/second.
 */

/**
 * The game's name, used everywhere (logo, page title, credits, announcer). It is deliberately our
 * own name: "Road Rash" is an Electronic Arts trademark and only appears in descriptive SEO text
 * ("inspired by"), never as the product name or logo. A painted logo (images/ui/logo) is only used
 * when it spells LOGO_ART_TITLE; otherwise the title is drawn as a chrome logo in code.
 */
export const GAME_TITLE = 'BLACKTOP BRAWL';
export const LOGO_ART_TITLE = 'BLACKTOP BRAWL';
export const GAME_SUBTITLE = '16-BIT MOTORCYCLE COMBAT RACING';

// --- screen ----------------------------------------------------------------------------------
export const WIDTH = 1280;
export const HEIGHT = 720;
/** Height of the 3D road view; the dashboard HUD fills the rest of the screen below it. */
export const VIEW_HEIGHT = 572;
export const HUD_HEIGHT = HEIGHT - VIEW_HEIGHT;

// --- road / camera ---------------------------------------------------------------------------
export const SEGMENT_LENGTH = 200;
export const RUMBLE_LENGTH = 3;
export const ROAD_WIDTH = 1750;
export const LANES = 2;
/**
 * Chase camera. Mutable on purpose: tweak live from the dev console, e.g.
 *   __game.scene.cameraRig.fov = 80
 * (the debug overlay shows the current values).
 */
export const CAMERA = {
  /** horizontal field of view in degrees */
  fov: 80,
  /** camera height above the road */
  height: 1000,
  /** distance from the camera to the player's bike */
  distance: 2400,
  /** where the horizon sits, as a fraction of VIEW_HEIGHT, on flat road */
  horizon: 0.37,
};
/** Camera presets the player cycles with V (or Select). */
export type CameraMode = 'chase' | 'high' | 'first';
export const CAMERA_MODES: Record<CameraMode, { fov: number; height: number; distance: number; horizon: number; label: string }> = {
  chase: { fov: 80, height: 1000, distance: 2400, horizon: 0.37, label: 'CHASE CAM' },
  high: { fov: 82, height: 1550, distance: 3500, horizon: 0.31, label: 'HIGH CHASE CAM' },
  first: { fov: 74, height: 900, distance: 260, horizon: 0.44, label: 'FIRST PERSON' },
};
export const CAMERA_ORDER: CameraMode[] = ['chase', 'high', 'first'];

/** focal length derived from the field of view */
export const cameraDepth = () => 1 / Math.tan(((CAMERA.fov / 2) * Math.PI) / 180);
export const DRAW_DISTANCE = 300;
export const FOG_DENSITY = 4;

// --- physics ---------------------------------------------------------------------------------
/** world units per second for 1 mph */
export const MPH = 60;
export const GRAVITY = 9000;
export const CENTRIFUGAL = 0.34;
/** how far off the road (normalised x) riders may go */
export const MAX_X = 3.2;
/** off-road speed cap as a fraction of top speed */
export const OFFROAD_LIMIT = 0.55;
export const RUN_SPEED = 1400;
/** how fast steering input ramps in / out (per second); lower = smoother, higher = twitchier */
export const STEER_RESPONSE = 6;
export const STEER_RETURN = 9;
/** below this speed (mph) hitting a roadside object just stops you instead of throwing you off */
export const OBSTACLE_CRASH_MPH = 40;

// --- world sizes (units) ---------------------------------------------------------------------
export const RIDER_HEIGHT = 820;
export const RIDER_HALF_WIDTH = 0.12; // normalised
export const CAR_HALF_WIDTH = 0.27;
export const CAR_LENGTH = 900;

// --- race rules ------------------------------------------------------------------------------
export const RACERS = 15;
export const QUALIFY_PLACE = 4;
export const STARTING_CASH = 1000;
export const TRACK_COUNT = 5;
export const LEVEL_COUNT = 5;
