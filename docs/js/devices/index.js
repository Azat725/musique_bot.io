import cassette from './cassette.js';
import cd from './cd.js';
import phonograph from './phonograph.js';
import reel from './reel.js';

/** Every player there is, in the order Settings shows them. The record and the turntable are drawn by vinyl.js itself;
 *  the others are device modules. */
export const PLAYER_MODES = ['record', 'turntable', 'cassette', 'reel', 'cd', 'phonograph'];
export const DEVICES = { cassette, reel, cd, phonograph };
