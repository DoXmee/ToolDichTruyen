import { describe, expect, it } from 'vitest';
import { createEmptyStoryMemory, formatStoryMemoryForPrompt, mergeStoryMemory } from '../../src/core/storyMemory';
import type { CharacterRelation } from '../../src/shared/types';

const relation: CharacterRelation = {
  id: 'AB', sourceCharacter: 'Lý Minh', targetCharacter: 'Trương Cường',
  relationType: 'Anh em', pronounSample: 'anh - em',
  directionalAddress: {
    aToB: { self: 'anh', call: 'em', tenseSelf: 'tôi', tenseCall: 'cậu' },
    bToA: { self: 'em', call: 'anh', tenseSelf: 'tôi', tenseCall: 'anh' },
  },
};
function memory() {
  const m = createEmptyStoryMemory();
  m.entities = [
    { id: 'a', category: 'character', chinese: '李明', vietnamese: 'Lý Minh', gender: 'male' },
    { id: 'b', category: 'character', chinese: '張強', vietnamese: 'Trương Cường', gender: 'male' },
  ];
  m.relations = [structuredClone(relation)];return m;
}
describe('merging directional relationships', () => {
  it('aligns reversed updates including tense forms without mutating either input', () => {
    const m = memory();
    const incoming = { relations: [{ ...structuredClone(relation), id: 'BA',
      sourceCharacter: ' Trương Cường ', targetCharacter: ' lý minh ',
      directionalAddress: { aToB: structuredClone(relation.directionalAddress!.bToA), bToA: structuredClone(relation.directionalAddress!.aToB) },
    }] };
    const before = JSON.stringify({ m, incoming });
    const result = mergeStoryMemory(m, incoming);
    expect(result.relations).toHaveLength(1);
    expect(result.relations[0]).toMatchObject(relation);
    expect(JSON.stringify({ m, incoming })).toBe(before);
    const prompt = formatStoryMemoryForPrompt(result, '李明和張強說話。');
    expect(prompt).toContain('Lý Minh -> Trương Cường: Tự xưng "anh", gọi đối phương "em"');
    expect(prompt).toContain('Trương Cường -> Lý Minh: Tự xưng "em", gọi đối phương "anh"');
  });
  it('accepts same-direction address changes without swapping them', () => {
    const changed = { ...structuredClone(relation), directionalAddress: {
      aToB: { self: 'tôi', call: 'cậu' }, bToA: { self: 'tôi', call: 'anh' },
    } };
    expect(mergeStoryMemory(memory(), { relations: [changed] }).relations[0]?.directionalAddress).toEqual(changed.directionalAddress);
  });
  it('retains existing directions when a reversed update has no address', () => {
    const incoming = { ...structuredClone(relation), sourceCharacter: relation.targetCharacter,
      targetCharacter: relation.sourceCharacter, directionalAddress: undefined };
    expect(mergeStoryMemory(memory(), { relations: [incoming] }).relations[0]?.directionalAddress).toEqual(relation.directionalAddress);
  });
  it('retains the original orientation when creating a new reversed-order relation', () => {
    const incoming = { ...structuredClone(relation), sourceCharacter: relation.targetCharacter,
      targetCharacter: relation.sourceCharacter };
    expect(mergeStoryMemory(createEmptyStoryMemory(), { relations: [incoming] }).relations[0]).toMatchObject(incoming);
  });
  it('does not flip-flop on repeated alternating updates', () => {
    let m = memory();
    for(let i=0;i<6;i++) {
      const next = structuredClone(relation);
      if(i%2) { [next.sourceCharacter,next.targetCharacter] = [next.targetCharacter,next.sourceCharacter];
        [next.directionalAddress!.aToB,next.directionalAddress!.bToA] = [next.directionalAddress!.bToA,next.directionalAddress!.aToB]; }
      m = mergeStoryMemory(m, { relations: [next] });
      expect(m.relations[0]?.directionalAddress).toEqual(relation.directionalAddress);
      expect(m.relations[0]?.sourceCharacter).toBe(relation.sourceCharacter);
    }
  });
});
