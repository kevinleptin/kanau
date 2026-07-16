import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { ApiService } from '../../core/api.service';
import { CaptureDto, NoteDto, NoteSearchResult, NoteTypeLabel, NoteTypeStr } from '../../core/models';
import { CaptureInput } from '../../shared/capture-input/capture-input';

const NOTE_TYPE_COLORS: Record<NoteTypeStr, string> = {
  inspiration: 'gold',
  reading: 'geekblue',
  meeting: 'cyan',
  emotion: 'magenta',
  diary: 'green',
  other: 'default'
};

@Component({
  selector: 'app-notes',
  imports: [DatePipe, FormsModule, NzButtonModule, NzInputModule, NzSpinModule, NzTagModule, CaptureInput],
  template: `
    <div class="page">
      <h1 class="page-title">思考笔记 ✏️</h1>

      <app-capture-input (captureReady)="onCaptureReady($event)" />

      <!-- 搜索 -->
      <div class="search-row">
        <input nz-input [(ngModel)]="searchQ" placeholder="🔍 搜索笔记（支持语义搜索）"
               (keyup.enter)="search()" />
        @if (searching() || searchResults() !== null) {
          <button nz-button (click)="clearSearch()">清除</button>
        } @else {
          <button nz-button nzType="primary" [disabled]="!searchQ.trim()" (click)="search()">搜索</button>
        }
      </div>

      @if (searching()) {
        <div class="center"><nz-spin nzSimple /></div>
      } @else if (searchResults(); as results) {
        <div class="search-head">找到 {{ results.length }} 条相关笔记</div>
        @for (r of results; track r.note.id) {
          <div class="kanau-card note-card">
            <div class="note-text">{{ r.note.text }}</div>
            <div class="note-meta">
              <nz-tag [nzColor]="typeColor(r.note.noteType)">{{ typeLabel(r.note.noteType) }}</nz-tag>
              @if (r.score > 0) {
                <span class="score">相关度 {{ (r.score * 100).toFixed(0) }}%</span>
              }
              <span class="time">{{ r.note.createdAt | date: 'M月d日 HH:mm' }}</span>
            </div>
          </div>
        } @empty {
          <div class="kanau-card empty-card">没有找到相关笔记</div>
        }
      } @else {
        <!-- 笔记列表 -->
        @if (loading()) {
          <div class="center"><nz-spin nzSimple /></div>
        }
        @for (n of notes(); track n.id) {
          <div class="kanau-card note-card">
            <div class="note-text">{{ n.text || '（内容处理中…）' }}</div>
            <div class="note-tags">
              <nz-tag [nzColor]="typeColor(n.noteType)">{{ typeLabel(n.noteType) }}</nz-tag>
              @for (t of n.tags; track t) {
                <span class="tag-chip"># {{ t }}</span>
              }
            </div>
            <div class="note-meta">
              <span class="time">{{ n.createdAt | date: 'M月d日 HH:mm' }}</span>
              @if (n.capture?.resolvedAddress; as addr) {
                <span class="addr">📍 {{ addr }}</span>
              }
              @if (n.capture && n.capture.type !== 'text') {
                <span class="cap-type">{{ capTypeLabel(n.capture.type) }}</span>
              }
              <span class="spacer"></span>
              <button type="button" class="del-btn" (click)="deleteNote(n)">删除</button>
            </div>

            @for (link of pendingLinks(n); track link.id) {
              <div class="link-box">
                <div class="link-text">💡 这条笔记可能与梦想「{{ dreamTitle(link.dreamId) }}」相关</div>
                <div class="link-actions">
                  <button nz-button nzSize="small" nzType="primary" (click)="confirmLink(n, link.id, true)">是的</button>
                  <button nz-button nzSize="small" (click)="confirmLink(n, link.id, false)">不相关</button>
                </div>
              </div>
            }
          </div>
        } @empty {
          @if (!loading()) {
            <div class="kanau-card empty-card">还没有笔记，随手记一条吧 ✨</div>
          }
        }

        @if (hasMore()) {
          <button nz-button nzBlock [nzLoading]="loadingMore()" (click)="loadMore()">加载更多</button>
        }
      }
    </div>
  `,
  styles: [`
    .center { display: flex; justify-content: center; padding: 30px 0; }
    .search-row { display: flex; gap: 8px; margin: 14px 0; }
    .search-row input { border-radius: 10px; height: 40px; }
    .search-row button { border-radius: 10px; height: 40px; }
    .search-head { font-size: 13px; color: #8c6b53; margin-bottom: 10px; }
    .note-card { margin-bottom: 12px; }
    .note-text { font-size: 15px; color: #4a3428; white-space: pre-wrap; word-break: break-word; }
    .note-tags { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; margin-top: 8px; }
    .tag-chip { font-size: 11px; color: #3d9bff; background: #eef6ff; border-radius: 8px; padding: 2px 8px; }
    .note-meta { display: flex; align-items: center; gap: 8px; margin-top: 8px; font-size: 12px; color: #b0a094; flex-wrap: wrap; }
    .spacer { flex: 1; }
    .del-btn { border: none; background: transparent; color: #d0c0b2; font-size: 12px; cursor: pointer; }
    .cap-type { background: #f5eee7; border-radius: 6px; padding: 1px 6px; }
    .score { color: #d95a2b; }
    .link-box { margin-top: 10px; background: #fffbe8; border: 1px dashed #ffd666; border-radius: 10px; padding: 10px; }
    .link-text { font-size: 13px; color: #8c6b53; margin-bottom: 8px; }
    .link-actions { display: flex; gap: 8px; }
    .empty-card { text-align: center; color: #b0a094; padding: 26px 14px; }
  `]
})
export class NotesPage implements OnInit {
  private api = inject(ApiService);
  private message = inject(NzMessageService);

  readonly loading = signal(true);
  readonly loadingMore = signal(false);
  readonly notes = signal<NoteDto[]>([]);
  readonly hasMore = signal(false);
  readonly searching = signal(false);
  readonly searchResults = signal<NoteSearchResult[] | null>(null);

  private page = 1;
  private readonly pageSize = 20;
  private dreamTitles = new Map<string, string>();

  searchQ = '';

  ngOnInit(): void {
    this.load(true);
    this.api.listDreams().subscribe({
      next: (list) => {
        this.dreamTitles = new Map(list.map((d) => [d.id, d.title]));
      },
      error: () => void 0
    });
  }

  private load(reset: boolean): void {
    if (reset) { this.page = 1; this.loading.set(true); }
    this.api.listNotes(this.page, this.pageSize).subscribe({
      next: (r) => {
        this.notes.set(reset ? r.items : [...this.notes(), ...r.items]);
        this.hasMore.set(this.notes().length < r.total);
        this.loading.set(false);
        this.loadingMore.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.loadingMore.set(false);
      }
    });
  }

  loadMore(): void {
    this.page += 1;
    this.loadingMore.set(true);
    this.load(false);
  }

  onCaptureReady(cap: CaptureDto): void {
    this.api.createNote(cap.id).subscribe({
      next: () => {
        this.message.success('笔记已保存 📝');
        this.load(true);
      },
      error: () => this.message.error('保存笔记失败，请重试')
    });
  }

  typeLabel(t: NoteTypeStr): string {
    return NoteTypeLabel[t] ?? t;
  }

  typeColor(t: NoteTypeStr): string {
    return NOTE_TYPE_COLORS[t] ?? 'default';
  }

  capTypeLabel(t: string): string {
    return { audio: '🎤 语音', image: '📷 照片', video: '🎬 视频' }[t] ?? '';
  }

  pendingLinks(n: NoteDto) {
    return (n.links ?? []).filter((l) => !l.confirmed);
  }

  dreamTitle(dreamId: string): string {
    return this.dreamTitles.get(dreamId) ?? '某个梦想';
  }

  confirmLink(note: NoteDto, linkId: string, confirmed: boolean): void {
    this.api.confirmNoteLink(linkId, confirmed).subscribe({
      next: () => {
        this.notes.set(this.notes().map((n) => n.id !== note.id ? n : {
          ...n,
          links: confirmed
            ? n.links.map((l) => (l.id === linkId ? { ...l, confirmed: true } : l))
            : n.links.filter((l) => l.id !== linkId)
        }));
        if (confirmed) this.message.success('已连接到梦想 💫');
      },
      error: () => this.message.error('操作失败，请重试')
    });
  }

  deleteNote(n: NoteDto): void {
    this.api.deleteNote(n.id).subscribe({
      next: () => this.notes.set(this.notes().filter((x) => x.id !== n.id)),
      error: () => this.message.error('删除失败')
    });
  }

  search(): void {
    const q = this.searchQ.trim();
    if (!q) return;
    this.searching.set(true);
    this.api.searchNotes(q, 20).subscribe({
      next: (r) => {
        this.searching.set(false);
        this.searchResults.set(r);
      },
      error: () => {
        this.searching.set(false);
        this.message.error('搜索失败，请重试');
      }
    });
  }

  clearSearch(): void {
    this.searchQ = '';
    this.searching.set(false);
    this.searchResults.set(null);
  }
}
