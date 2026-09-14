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
