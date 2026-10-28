import { describe, expect, it } from 'vitest';
import {
  isAddressHonorificOrPrefix,
  resolveDirectionalAddress,
  updateGenderScore,
  type StoryBibleEntity,
  type StoryBibleRelation,
} from '../../src/core/storyBible';
import { PERIOD_GENRE_PROFILE } from '../../src/core/genreProfile';

describe('storyBible module', () => {
  it('identifies address forms and prefixes to prevent creating duplicate entities', () => {
    expect(isAddressHonorificOrPrefix('小郑')).toBe(true);
    expect(isAddressHonorificOrPrefix('老顾')).toBe(true);
    expect(isAddressHonorificOrPrefix('李妹')).toBe(true);
    expect(isAddressHonorificOrPrefix('强哥')).toBe(true);

    // Regular full names are not simple honorifics
    expect(isAddressHonorificOrPrefix('顾国强')).toBe(false);
    expect(isAddressHonorificOrPrefix('沈玉兰')).toBe(false);
  });

  it('updates Bayesian gender score and decides gender when threshold is reached', () => {
    const entity: StoryBibleEntity = {
      id: 'ent-1',
      category: 'character',
      zh: '顾国强',
      vi: 'Cố Quốc Cường',
      gender: 'unknown',
    };

    // 1. Observation: kinTerm "cha" (weight 5)
    const step1 = updateGenderScore(entity, { type: 'kinTerm', gender: 'male' });
    expect(step1.m).toBe(5);
    expect(step1.f).toBe(0);
    expect(step1.decidedGender).toBe('male'); // hi >= 5 and hi - lo >= 4

    // 2. Conflicting female signal of weak weight
    const step2 = updateGenderScore(
      { ...entity, genderScore: { m: step1.m, f: step1.f } },
      { type: 'pronounCrowded', gender: 'female' },
    );
    expect(step2.m).toBe(5);
    expect(step2.f).toBe(1);
    expect(step2.decidedGender).toBe('male'); // 5 - 1 = 4 >= 4
  });

  it('resolves directional address with normal vs tense state', () => {
    const father: StoryBibleEntity = {
      id: 'fa-1',
      category: 'character',
      zh: '顾国强',
      vi: 'Cố Quốc Cường',
      gender: 'male',
    };

    const son: StoryBibleEntity = {
      id: 'so-1',
      category: 'character',
      zh: '顾谨书',
      vi: 'Cố Cẩn Thư',
      gender: 'male',
    };

    const relation: StoryBibleRelation = {
      id: 'rel-1',
      from: father.id,
      to: son.id,
      type: 'parent_child',
      address: {
        aToB: { self: 'cha', call: 'con', tenseSelf: 'tao', tenseCall: 'mày' },
        bToA: { self: 'con', call: 'cha', tenseSelf: 'tôi', tenseCall: 'ông' },
      },
    };

    // Normal state: Father -> Son
    const normalFaToSon = resolveDirectionalAddress(father, son, relation, 'normal', PERIOD_GENRE_PROFILE);
    expect(normalFaToSon).toEqual({ self: 'cha', call: 'con', isTense: false });

    // Tense/Conflict state: Father -> Son
    const tenseFaToSon = resolveDirectionalAddress(father, son, relation, 'tense', PERIOD_GENRE_PROFILE);
    expect(tenseFaToSon).toEqual({ self: 'tao', call: 'mày', isTense: true });

    // Normal state: Son -> Father
    const normalSonToFa = resolveDirectionalAddress(son, father, relation, 'normal', PERIOD_GENRE_PROFILE);
    expect(normalSonToFa).toEqual({ self: 'con', call: 'cha', isTense: false });

    // Hostile state: Son -> Father
    const hostileSonToFa = resolveDirectionalAddress(son, father, relation, 'hostile', PERIOD_GENRE_PROFILE);
    expect(hostileSonToFa).toEqual({ self: 'tôi', call: 'ông', isTense: true });
  });
});
