/**
 * 검사 결과의 타입 정의.
 *
 * script(check_setting.py) 출력 JSON을 그대로 근거로 사용한다.
 * 스크립트 실행 없이 값을 지어내지 않으며, 검사하지 못한 것을 문제없다고 말하지 않는다.
 */

/** 요약 집계 */
export interface CheckSummary {
  total: number;
  high: number;
  medium: number;
  low: number;
  listed: number;
  omitted_duplicates: number;
  proposed: number;
  manuscript_chars: number;
}

/** 개별 위반(설정오류·확인필요 통합) 항목 */
export interface Violation {
  type: string;
  severity: "high" | "medium" | "low";
  line: number;
  subject: string;
  detail: string;
  context: string;
  repeated?: boolean;
  /** 출처: 규칙(script)인지 솔라(solar)인지 구분 */
  source?: "rule" | "solar";
}

/** 추가제안 후보 항목 */
export interface ProposedAddition {
  name: string;
  count: number;
  first_line: number;
  context: string;
  note?: string;
  /** 사용자가 지정한 분류. 비워 두면 미분류 */
  category?: "인물" | "지명" | "세계관" | "제외";
  /** Solar 정제 결과: 고유명사 판정 여부 */
  is_proper?: boolean;
  /** Solar 정제 결과: Solar가 부여한 분류(참조용) */
  refine_category?: string;
  /** Solar 정제 결과: 판정 근거 */
  refine_reason?: string;
}

/** Solar 인물 상세 정보 보강 후보(인물 이름만 전달) */
export interface EnrichCandidate {
  name: string;
  episode?: number;
}

/** 인물 필드 보강 결과 항목 */
export interface EnrichItem {
  name: string;
  episode?: number;
  fields: {
    age?: number | null;
    affiliation?: string | null;
    aliases?: string[] | null;
    notes?: string | null;
    /** age 근거 문장(없으면 null). 원문 존재 검증 통과한 것만 채움 */
    ageEvidence?: string | null;
    /** affiliation 근거 문장(없으면 null) */
    affiliationEvidence?: string | null;
    /** notes 근거 문장(없으면 null) */
    notesEvidence?: string | null;
  };
  /** 값이 채워진 근거: Solar(라이터)가 원고 기반으로 채움. 로컬 가공이면 'local' */
  source?: "solar" | "local";
}

/** 인물 상세 보강 결과 */
export interface EnrichResult {
  enriched: EnrichItem[];
  before: number;
  after: number;
  errors: string[];
}

/** 승인 결과(설정집 반영) */
export interface ApprovalResult {
  added: ProposedAddition[];
  skipped: number;
  /** 승인과 함께 인물 필드 보강이 진행된 경우 결과(인물 항목만) */
  enrichedItems?: EnrichItem[];
}

/** 검사 결과 전체 */
export interface CheckResult {
  summary: CheckSummary;
  violations: Violation[];
  proposed_additions: ProposedAddition[];
  not_checked: unknown[];
  errors: string[];
}

/** 분류 버튼에서 쓰는 4종류 */
export type PresetCategory = "인물" | "지명" | "세계관" | "제외";
