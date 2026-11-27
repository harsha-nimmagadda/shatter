import type { PowerType } from './config';
import type { Level } from './level';

/** A campaign level: a picture made of bricks that teaches one idea. */
export interface CampaignLevel extends Level {
  /** Short line shown under the name on the level intro and level select. */
  hint: string;
  /** Optional power-up whose drop weight is doubled on this level (used when a level introduces it). */
  featured?: PowerType;
  /**
   * Level score needed for 2 and 3 stars (1 star = cleared). Set from the Casual sim bot's median and top-20%
   * scores on this level (`npm run sim -- --levels c01,...`); recompute whenever the rows change.
   */
  stars: readonly [number, number];
}

/**
 * The 15-level campaign, world 1. Legend: '.' empty, '1'-'3' hit points, '#' metal clip (unbreakable),
 * 'x' bomb, 'm' sliding tab, 'r' re-sketching (regrows, does not count), 'h' invisible ink.
 * Teaching order: 1 HP, 2 HP, 3 HP, bombs, sliders, clips, invisible ink, regrowing hedges, then mixes.
 */
export const CAMPAIGN: readonly CampaignLevel[] = [
  {
    name: 'Heart',
    hint: 'Break every brick',
    stars: [1640, 1920],
    rows: [
      '.11....11.',
      '1111..1111',
      '1111111111',
      '1111111111',
      '.11111111.',
      '..111111..',
      '...1111...',
      '....11....',
    ],
  },
  {
    name: 'Smiley',
    hint: 'Outlined bricks take two hits',
    stars: [2060, 2390],
    rows: [
      '..111111..',
      '.11111111.',
      '1112112111',
      '1111111111',
      '1121111211',
      '1112222111',
      '.11111111.',
      '..111111..',
    ],
  },
  {
    name: 'Rocket',
    hint: 'The darkest bricks take three',
    featured: 'stapler',
    stars: [1960, 2280],
    rows: [
      '....33....',
      '...3223...',
      '...2112...',
      '...2112...',
      '..121121..',
      '..211112..',
      '.32111123.',
      '33.2112.33',
      '3...11...3',
    ],
  },
  {
    name: 'Chain Reaction',
    hint: 'Bombs set off their neighbours',
    stars: [3340, 3590],
    rows: [
      '2222222222',
      '2x222222x2',
      '22x2222x22',
      '222x22x222',
      '2222xx2222',
      '1111111111',
      '1111111111',
    ],
  },
  {
    name: 'Rush Hour',
    hint: 'Sliding bricks never sit still',
    stars: [1760, 2020],
    rows: [
      '3333333333',
      'm.........',
      '2222222222',
      '.....m....',
      '1111111111',
      'm........m',
      '1111111111',
    ],
  },
  {
    name: 'Fortress',
    hint: 'Metal clips can\'t break. Find the gate',
    featured: 'photocopy',
    stars: [1650, 2040],
    rows: [
      '.#..##..#.',
      '1111111111',
      '.22222222.',
      '.22333322.',
      '#22222222#',
      '#11....11#',
      '##......##',
    ],
  },
  {
    name: 'Ghost',
    hint: 'Some bricks are invisible until hit',
    stars: [2020, 2300],
    rows: [
      '...hhhh...',
      '..hhhhhh..',
      '.hh2hh2hh.',
      '.hhhhhhhh.',
      '.hhhhhhhh.',
      '.hhhhhhhh.',
      '.h.hh.hh.h',
    ],
  },
  {
    name: 'Hedge',
    hint: 'Green bricks grow back. Slip through fast',
    featured: 'crumpled',
    stars: [1380, 1540],
    rows: [
      '.1.1..1.1.',
      '1x1....1x1',
      '.1.1..1.1.',
      '..........',
      'rrrrrrrrrr',
      '2222222222',
      '1111111111',
    ],
  },
  {
    name: 'UFO',
    hint: 'Everything you know so far',
    stars: [1820, 2080],
    rows: [
      '...3333...',
      '..311113..',
      '.22222222.',
      '2h22hh22h2',
      '.22222222.',
      '..x....x..',
      '.1......1.',
      '1........1',
    ],
  },
  {
    name: 'Cat',
    hint: 'Boop the nose',
    stars: [2040, 2520],
    rows: [
      '2........2',
      '22......22',
      '2111111112',
      '1131111311',
      '1111111111',
      '1111x11111',
      '.11111111.',
      '..222222..',
    ],
  },
  {
    name: 'Storm',
    hint: 'Clouds drift across the bolt',
    featured: 'plane',
    stars: [1480, 1660],
    rows: [
      'm....m....',
      '....2222..',
      '...222....',
      '..2222222.',
      '.....222..',
      '....22....',
      '...2......',
      '1111111111',
    ],
  },
  {
    name: 'Ringed Planet',
    hint: 'Aim for the gaps in the ring',
    stars: [1600, 1800],
    rows: [
      '....22....',
      '..222222..',
      '.22233222.',
      '.#..##..#.',
      '.22222222.',
      '..222222..',
      '....22....',
    ],
  },
  {
    name: 'Maze',
    hint: 'Clips, bombs and hidden bricks',
    featured: 'eraser',
    stars: [1380, 1560],
    rows: [
      '1111111111',
      '#..####..#',
      '1x1hh1hx11',
      '2222222222',
      '##......##',
    ],
  },
  {
    name: 'Robot',
    hint: 'Its eyes are hidden',
    stars: [2020, 2340],
    rows: [
      '....##....',
      '..222222..',
      '.2h2222h2.',
      '.22222222.',
      '.2x3333x2.',
      '.22222222.',
      '...2..2...',
      '..33..33..',
    ],
  },
  {
    name: 'The Core',
    hint: 'Break into the core',
    featured: 'photocopy',
    stars: [1790, 2000],
    rows: [
      '..######..',
      '.#r3333r#.',
      '.#r3xx3r#.',
      '.#r3xx3r#.',
      '..rrrrrr..',
      '...#..#...',
      'm........m',
      'hhhhhhhhhh',
      '2222222222',
    ],
  },
];
