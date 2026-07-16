// ==== 与后端 API 对应的数据模型（响应中枚举为小写字符串，请求体中枚举为数字）====

export interface AuthResponse {
  token: string;
  userId: string;
  userName: string;
  nickname: string | null;
  isChild: boolean;
}

export interface UserMe {
  id: string;
  userName: string;
  nickname: string | null;
  avatarObjectKey: string | null;
  isChild: boolean;
  locationEnabled: boolean;
  totalPromptTokens: number;
  totalCompletionTokens: number;
}

export type CaptureTypeStr = 'text' | 'audio' | 'image' | 'video';
export type CaptureStatusStr = 'uploaded' | 'extracting' | 'correcting' | 'ready' | 'failed';

/** 请求体中的 CaptureType 数字枚举 */
export const CaptureTypeNum: Record<CaptureTypeStr, number> = {
  text: 0, audio: 1, image: 2, video: 3
};

export interface CaptureDto {
  id: string;
  type: CaptureTypeStr;
  cosObjectKey: string | null;
  mime: string | null;
  sizeBytes: number | null;
  durationSec: number | null;
  rawText: string | null;
  correctedText: string | null;
  status: CaptureStatusStr;
  failReason: string | null;
  lat: number | null;
  lng: number | null;
  resolvedAddress: string | null;
  createdAt: string;
}

export interface CosStsCredential {
  tmpSecretId: string;
  tmpSecretKey: string;
  sessionToken: string;
  expiredTime: number;
  bucket: string;
  region: string;
  objectKey: string;
}

export type PyramidAreaStr = 'health' | 'knowledge' | 'mind' | 'work' | 'family' | 'wealth';
export type DreamStatusStr = 'draft' | 'active' | 'achieved' | 'archived';

/** 六大领域：请求体数字枚举值 */
export const PyramidAreaNum: Record<PyramidAreaStr, number> = {
  health: 0, knowledge: 1, mind: 2, work: 3, family: 4, wealth: 5
};

/** 六大领域中文名 */
export const PyramidAreaLabel: Record<PyramidAreaStr, string> = {
  health: '健康',
  knowledge: '修养·知识',
  mind: '心灵·精神',
  work: '社会·工作',
  family: '私人·家庭',
  wealth: '经济·物质'
};

export const PyramidAreaOrder: PyramidAreaStr[] = ['wealth', 'work', 'family', 'health', 'knowledge', 'mind'];

export interface DreamDto {
  id: string;
  title: string;
  quantifiedText: string | null;
  pyramidArea: PyramidAreaStr;
  targetDate: string | null;
  status: DreamStatusStr;
  coverObjectKey: string | null;
  lat: number | null;
  lng: number | null;
  placeName: string | null;
  sourceCaptureId: string | null;
  aiSuggestion: string | null;
  createdAt: string;
  achievedAt: string | null;
}

export interface PyramidAreaStat {
  area: PyramidAreaStr;
  total: number;
  achieved: number;
  active: number;
}

export interface SmartSuggestion {
  quantifiedText: string;
  pyramidArea: string;
  targetDate: string | null;
  reason: string | null;
}

export interface YearFocus { year: number; focus: string; }
export interface MonthPlan { month: string; items: string[]; }
export interface WeekPlan { week: string; items: string[]; }
export interface DayTodos { date: string; items: string[]; }

export interface DecomposeDraft {
  musts: string[];
  yearlyFocus: YearFocus[];
  monthlyPlans: MonthPlan[];
  weeklyPlans: WeekPlan[];
  dailyTodos: DayTodos[];
}

export type PlanLevelStr = 'year' | 'month' | 'week';

export interface PlanDto {
  id: string;
  dreamId: string;
  level: PlanLevelStr;
  content: string;
  period: string | null;
  sortOrder: number;
  source: 'ai' | 'manual';
}

export type TodoStatusStr = 'pending' | 'done' | 'postponed' | 'cancelled';

export interface TodoDto {
  id: string;
  planId: string | null;
  dreamId: string | null;
  date: string;
  title: string;
  status: TodoStatusStr;
  postponeCount: number;
  geoFence: string | null;
  doneAt: string | null;
}

export interface TodayBrief {
  dream: DreamDto | null;
  countdownDays: number | null;
  todos: TodoDto[];
}

export type NoteTypeStr = 'inspiration' | 'reading' | 'meeting' | 'emotion' | 'diary' | 'other';

export const NoteTypeLabel: Record<NoteTypeStr, string> = {
  inspiration: '灵感',
  reading: '读书摘录',
  meeting: '会议',
  emotion: '情绪',
  diary: '日常',
  other: '其他'
};

export interface NoteLinkDto {
  id: string;
  dreamId: string;
  score: number;
  confirmed: boolean;
}

export interface NoteDto {
  id: string;
  captureId: string;
  noteType: NoteTypeStr;
  tags: string[];
  text: string | null;
  capture: CaptureDto | null;
  links: NoteLinkDto[];
  createdAt: string;
  resolvedAddress?: string | null;
}

export interface NoteSearchResult {
  note: NoteDto;
  score: number;
}

export interface ReviewDto {
  id: string;
  periodType: 'week' | 'month';
  periodStart: string;
  stats: string | null;
  aiComment: string | null;
  captureIds: string | null;
  createdAt: string;
}

/** stats JSON 解析后的形状（后端匿名对象，成员名保持原样） */
export interface ReviewStats {
  total: number;
  done: number;
  completionRate: number;
  mostPostponed: { Title: string; PostponeCount: number }[];
  areaStats: Record<string, number>;
}

export interface TimelineEntryDto {
  id: string;
  year: number;
  content: string;
  dreamId: string | null;
}

export interface PagedResult<T> {
  total: number;
  items: T[];
}
