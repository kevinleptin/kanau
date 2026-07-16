import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import {
  CaptureDto, CosStsCredential, DecomposeDraft, DreamDto, NoteDto, NoteSearchResult,
  PagedResult, PlanDto, PyramidAreaStat, ReviewDto, SmartSuggestion, TimelineEntryDto,
  TodayBrief, TodoDto, UserMe
} from './models';

/** 统一的 Kanau 后端 API 客户端（相对路径，生产环境同域走 Nginx）。 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);

  /** 当前用户资料缓存（locationEnabled 等） */
  readonly me = signal<UserMe | null>(null);

  // ==================== 用户 ====================
  loadMe(): Observable<UserMe> {
    return this.http.get<UserMe>('/api/users/me').pipe(tap((u) => this.me.set(u)));
  }

  updateMe(req: { nickname?: string; avatarObjectKey?: string; locationEnabled?: boolean }): Observable<{ message: string }> {
    return this.http.put<{ message: string }>('/api/users/me', req);
  }

  clearLocations(): Observable<{ cleared: number }> {
    return this.http.post<{ cleared: number }>('/api/users/me/clear-locations', {});
  }

  // ==================== 速记输入 (Captures) ====================
  createTextCapture(req: { text: string; lat?: number; lng?: number }): Observable<CaptureDto> {
    return this.http.post<CaptureDto>('/api/captures/text', req);
  }

  requestUploadCredential(ext: string, mime: string): Observable<CosStsCredential> {
    return this.http.post<CosStsCredential>('/api/captures/upload-credential', { ext, mime });
  }

  confirmUpload(req: {
    objectKey: string; mime: string; sizeBytes: number; durationSec?: number;
    type: number; lat?: number; lng?: number;
  }): Observable<CaptureDto> {
    return this.http.post<CaptureDto>('/api/captures/confirm', req);
  }

  getCapture(id: string): Observable<CaptureDto> {
    return this.http.get<CaptureDto>(`/api/captures/${id}`);
  }

  retryCapture(id: string): Observable<CaptureDto> {
    return this.http.post<CaptureDto>(`/api/captures/${id}/retry`, {});
  }

  captureOriginalUrl(id: string): Observable<{ url: string }> {
    return this.http.get<{ url: string }>(`/api/captures/${id}/original-url`);
  }

  // ==================== 梦想 (Dreams) ====================
  listDreams(): Observable<DreamDto[]> {
    return this.http.get<DreamDto[]>('/api/dreams');
  }

  getDream(id: string): Observable<DreamDto> {
    return this.http.get<DreamDto>(`/api/dreams/${id}`);
  }

  createDream(req: {
    title: string; quantifiedText?: string | null; pyramidArea: number;
    targetDate?: string | null; coverObjectKey?: string | null; sourceCaptureId?: string | null;
  }): Observable<DreamDto> {
    return this.http.post<DreamDto>('/api/dreams', req);
  }

  setDreamStatus(id: string, status: number): Observable<DreamDto> {
    return this.http.post<DreamDto>(`/api/dreams/${id}/status`, status);
  }

  deleteDream(id: string): Observable<void> {
    return this.http.delete<void>(`/api/dreams/${id}`);
  }

  pyramid(): Observable<PyramidAreaStat[]> {
    return this.http.get<PyramidAreaStat[]>('/api/dreams/pyramid');
  }

  dreamCoverUrl(id: string): Observable<{ url: string }> {
    return this.http.get<{ url: string }>(`/api/dreams/${id}/cover-url`);
  }

  smartRewrite(id: string): Observable<SmartSuggestion> {
    return this.http.post<SmartSuggestion>(`/api/dreams/${id}/smart-rewrite`, {});
  }

  adoptSuggestion(id: string, final: SmartSuggestion): Observable<DreamDto> {
    return this.http.post<DreamDto>(`/api/dreams/${id}/adopt-suggestion`, final);
  }

  // ==================== 计划 (Plans) ====================
  decompose(dreamId: string): Observable<DecomposeDraft> {
    return this.http.post<DecomposeDraft>(`/api/plans/decompose/${dreamId}`, {});
  }

  adoptPlan(dreamId: string, draft: DecomposeDraft): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`/api/plans/adopt/${dreamId}`, draft);
  }

  plansByDream(dreamId: string): Observable<PlanDto[]> {
    return this.http.get<PlanDto[]>(`/api/plans/dream/${dreamId}`);
  }

  deletePlan(id: string): Observable<void> {
    return this.http.delete<void>(`/api/plans/${id}`);
  }

  // ==================== 待办 (Todos) ====================
  todayBrief(): Observable<TodayBrief> {
    return this.http.get<TodayBrief>('/api/todos/today-brief');
  }

  listTodos(date?: string): Observable<TodoDto[]> {
    let params = new HttpParams();
    if (date) params = params.set('date', date);
    return this.http.get<TodoDto[]>('/api/todos', { params });
  }

  createTodo(req: { title: string; date?: string; dreamId?: string }): Observable<TodoDto> {
    return this.http.post<TodoDto>('/api/todos', req);
  }

  toggleTodo(id: string): Observable<TodoDto> {
    return this.http.post<TodoDto>(`/api/todos/${id}/toggle`, {});
  }

  deleteTodo(id: string): Observable<void> {
    return this.http.delete<void>(`/api/todos/${id}`);
  }

  // ==================== 速记 (Notes) ====================
  createNote(captureId: string): Observable<NoteDto> {
    return this.http.post<NoteDto>('/api/notes', { captureId });
  }

  listNotes(page = 1, pageSize = 20): Observable<PagedResult<NoteDto>> {
    const params = new HttpParams().set('page', page).set('pageSize', pageSize);
    return this.http.get<PagedResult<NoteDto>>('/api/notes', { params });
  }

  searchNotes(q: string, limit = 10): Observable<NoteSearchResult[]> {
    const params = new HttpParams().set('q', q).set('limit', limit);
    return this.http.get<NoteSearchResult[]>('/api/notes/search', { params });
  }

  confirmNoteLink(linkId: string, confirmed: boolean): Observable<void> {
    return this.http.post<void>(`/api/notes/links/${linkId}/confirm`, confirmed);
  }

  deleteNote(id: string): Observable<void> {
    return this.http.delete<void>(`/api/notes/${id}`);
  }

  // ==================== 回顾 (Reviews) ====================
  listReviews(limit = 12): Observable<ReviewDto[]> {
    return this.http.get<ReviewDto[]>('/api/reviews', { params: new HttpParams().set('limit', limit) });
  }

  generateReview(periodType: number): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`/api/reviews/generate?periodType=${periodType}`, {});
  }

  appendReviewCapture(reviewId: string, captureId: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`/api/reviews/${reviewId}/append-capture`, { captureId });
  }

  // ==================== 未来年表 (Timeline) ====================
  listTimeline(): Observable<TimelineEntryDto[]> {
    return this.http.get<TimelineEntryDto[]>('/api/timeline');
  }

  createTimeline(req: { year: number; content: string; dreamId?: string | null }): Observable<TimelineEntryDto> {
    return this.http.post<TimelineEntryDto>('/api/timeline', req);
  }

  updateTimeline(id: string, req: { year: number; content: string; dreamId?: string | null }): Observable<TimelineEntryDto> {
    return this.http.put<TimelineEntryDto>(`/api/timeline/${id}`, req);
  }

  deleteTimeline(id: string): Observable<void> {
    return this.http.delete<void>(`/api/timeline/${id}`);
  }
}
