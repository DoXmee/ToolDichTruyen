import type { GenreProfile } from './genreProfile.js';

export type EntityCategory = 'character' | 'location' | 'faction' | 'rank' | 'term' | 'cultivation';
export type EntityGender = 'male' | 'female' | 'unknown';
export type EntityStatus = 'candidate' | 'verified' | 'staged' | 'active' | 'locked' | 'conflict';
export type SceneState = 'normal' | 'tense' | 'hostile' | 'hidden';

export interface EntityAlias {
  zh: string;
  viDisplay?: string;
  ambiguousWith?: readonly string[];
}

export interface StoryBibleEntity {
  id: string;
  category: EntityCategory;
  zh: string;
  vi: string;
  aliases?: readonly EntityAlias[];
  gender?: EntityGender;
  genderScore?: { m: number; f: number };
  narrationPronoun?: string; // 'cậu ấy', 'anh', 'cô ấy', 'nàng', 'ông'
  role?: string;
  locks?: {
    vi?: boolean;
    gender?: boolean;
    category?: boolean;
  };
  confidence?: number;
  status?: EntityStatus;
  firstChapter?: number;
  lastChapter?: number;
}

export interface DirectionalAddress {
  self: string;
  call: string;
  tenseSelf?: string;
  tenseCall?: string;
}

export interface StoryBibleRelation {
  id: string;
  from: string; // Entity ID
  to: string;   // Entity ID
  type: string;
  validFrom?: number;
  validTo?: number;
  confidence?: number;
  address: {
    aToB: DirectionalAddress;
    bToA: DirectionalAddress;
  };
  stateByChapter?: Array<{
    chapter: number;
    state: SceneState;
  }>;
}

export interface ChapterDigest {
  chapter: number;
  title?: string;
  summary: string;
  presentEntityIds: readonly string[];
  povCharacterId?: string;
}

export interface StoryBible {
  schemaVersion: number;
  storyTitle?: string;
  profileId: string;
  entities: StoryBibleEntity[];
  relations: StoryBibleRelation[];
  timeline: ChapterDigest[];
  pending: StoryBibleEntity[]; // Staging candidate queue
  updatedAt: string;
}

export function createEmptyStoryBible(profileId = 'period'): StoryBible {
  return {
    schemaVersion: 2,
    profileId,
    entities: [],
    relations: [],
    timeline: [],
    pending: [],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Resolves an address form (e.g. 小郑 -> 小 + họ Trịnh, 老顾 -> lão + họ Cố)
 * to prevent spawning duplicate/junk entities.
 */
export function isAddressHonorificOrPrefix(zh: string): boolean {
  if (!zh || zh.length < 2 || zh.length > 4) return false;
  // Prefix forms: 小 (Tiểu), 老 (Lão), 大 (Đại), 阿 (A)
  if (/^[小老大大阿][\u4e00-\u9fa5]$/u.test(zh)) return true;
  // Suffix forms: 哥 (Ca/Anh), 姐 (Tỷ/Chị), 妹 (Muội/Em gái), 弟 (Đệ/Em trai), 叔 (Thúc), 婶 (Thẩm)
  if (/^[\u4e00-\u9fa5][哥姐妹弟叔婶姨娘爷婆]$/u.test(zh)) return true;
  return false;
}

/**
 * Bayesian-like weighted gender scoring according to Page 13 of the design specification:
 * weights: statedFact:5, kinTerm:5, relationImplied:5, pronounAdjacent:2, pronounCrowded:1, nameChar:0.5
 */
export interface GenderSignal {
  type: 'statedFact' | 'kinTerm' | 'relationImplied' | 'pronounAdjacent' | 'pronounCrowded' | 'nameChar';
  gender: 'male' | 'female';
}

const GENDER_WEIGHTS: Record<GenderSignal['type'], number> = {
  statedFact: 5,
  kinTerm: 5,
  relationImplied: 5,
  pronounAdjacent: 2,
  pronounCrowded: 1,
  nameChar: 0.5,
};

export function updateGenderScore(
  entity: StoryBibleEntity,
  signal: GenderSignal,
): { m: number; f: number; decidedGender: EntityGender } {
  if (entity.locks?.gender && entity.gender) {
    return {
      m: entity.genderScore?.m ?? (entity.gender === 'male' ? 5 : 0),
      f: entity.genderScore?.f ?? (entity.gender === 'female' ? 5 : 0),
      decidedGender: entity.gender,
    };
  }

  const currentM = entity.genderScore?.m ?? 0;
  const currentF = entity.genderScore?.f ?? 0;
  const weight = GENDER_WEIGHTS[signal.type] ?? 1;

  const newM = currentM + (signal.gender === 'male' ? weight : 0);
  const newF = currentF + (signal.gender === 'female' ? weight : 0);

  let decided: EntityGender = 'unknown';
  const hi = Math.max(newM, newF);
  const lo = Math.min(newM, newF);

  // Decision rule: hi >= 5 and difference >= 4 (Page 13)
  if (hi >= 5 && hi - lo >= 4) {
    decided = hi === newM ? 'male' : 'female';
  }

  return {
    m: newM,
    f: newF,
    decidedGender: decided,
  };
}

/**
 * Resolves the directional address between two characters given their relationship
 * and the current scene state (normal vs tense/conflict).
 */
export function resolveDirectionalAddress(
  speaker: StoryBibleEntity,
  listener: StoryBibleEntity,
  relation?: StoryBibleRelation,
  sceneState: SceneState = 'normal',
  genreProfile?: GenreProfile,
): { self: string; call: string; isTense: boolean } {
  // If a specific relation exists between them
  if (relation) {
    const isAToB = relation.from === speaker.id && relation.to === listener.id;
    const isBToA = relation.from === listener.id && relation.to === speaker.id;

    if (isAToB || isBToA) {
      const address = isAToB ? relation.address.aToB : relation.address.bToA;
      const isTenseState = sceneState === 'tense' || sceneState === 'hostile';

      if (isTenseState && address.tenseSelf && address.tenseCall) {
        return {
          self: address.tenseSelf,
          call: address.tenseCall,
          isTense: true,
        };
      }

      return {
        self: address.self,
        call: address.call,
        isTense: false,
      };
    }
  }

  // Fallback to genre profile defaults if available
  if (genreProfile?.addressDefaults?.length && relation?.type) {
    const matched = genreProfile.addressDefaults.find((d) => d.relationType === relation.type);
    if (matched) {
      const isTenseState = sceneState === 'tense' || sceneState === 'hostile';
      if (isTenseState && matched.tenseSelf && matched.tenseCall) {
        return {
          self: matched.tenseSelf,
          call: matched.tenseCall,
          isTense: true,
        };
      }
      return {
        self: matched.self,
        call: matched.call,
        isTense: false,
      };
    }
  }

  // Standard polite fallback
  return {
    self: 'tôi',
    call: listener.gender === 'female' ? 'cô' : 'anh',
    isTense: sceneState === 'tense' || sceneState === 'hostile',
  };
}
