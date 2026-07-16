import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzInputNumberModule } from 'ng-zorro-antd/input-number';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { ApiService } from '../../core/api.service';
import { TimelineEntryDto } from '../../core/models';

@Component({
  selector: 'app-timeline',
  imports: [FormsModule, RouterLink, NzButtonModule, NzInputModule, NzInputNumberModule, NzSpinModule],
  template: `
    <div class="page">
      <a routerLink="/settings" class="back">← 返回我的</a>
      <h1 class="page-title">未来年表 📜</h1>
      <p class="intro">想象未来的自己：哪一年，想成为什么样的人、做成什么事？</p>

      <!-- 新增 -->
      <div class="kanau-card add-card">
        <div class="add-row">
          <nz-input-number [(ngModel)]="newYear" [nzMin]="1900" [nzMax]="2200" [nzStep]="1" class="year-input" />
          <input nz-input [(ngModel)]="newContent" placeholder="这一年想实现什么？" (keyup.enter)="add()" />
        </div>
        <button nz-button nzType="primary" nzBlock [disabled]="!newContent.trim()" (click)="add()">添加</button>
      </div>

      @if (loading()) {
        <div class="center"><nz-spin nzSimple /></div>
      }

      <div class="timeline">
        @for (e of entries(); track e.id) {
          <div class="tl-item">
            <div class="tl-year">{{ e.year }}</div>
            <div class="tl-card kanau-card">
              @if (editingId() === e.id) {
                <nz-input-number [(ngModel)]="editYear" [nzMin]="1900" [nzMax]="2200" class="year-input" />
                <textarea nz-input rows="2" [(ngModel)]="editContent" class="edit-area"></textarea>
                <div class="btn-row">
                  <button nz-button nzSize="small" nzType="primary" [disabled]="!editContent.trim()" (click)="saveEdit(e)">保存</button>
                  <button nz-button nzSize="small" (click)="editingId.set(null)">取消</button>
                </div>
              } @else {
                <div class="tl-content">{{ e.content }}</div>
                <div class="tl-actions">
                  <button type="button" class="link-btn" (click)="startEdit(e)">编辑</button>
                  <button type="button" class="link-btn danger" (click)="remove(e)">删除</button>
                </div>
              }
            </div>
          </div>
        } @empty {
          @if (!loading()) {
            <div class="kanau-card empty-card">还没有年表内容，写下第一条对未来的想象吧 ✨</div>
          }
        }
      </div>
    </div>
  `,
  styles: [`
    .back { display: inline-block; color: #b26a45; text-decoration: none; margin-bottom: 8px; font-size: 14px; }
    .intro { color: #8c6b53; font-size: 13px; margin: -6px 0 14px; }
    .center { display: flex; justify-content: center; padding: 30px 0; }
    .add-card { margin-bottom: 18px; }
    .add-row { display: flex; gap: 8px; margin-bottom: 10px; }
    .year-input { width: 110px; flex-shrink: 0; }
    .add-row input { border-radius: 10px; }
    .timeline { position: relative; padding-left: 4px; }
    .tl-item { display: flex; gap: 12px; margin-bottom: 14px; align-items: flex-start; }
    .tl-year { flex-shrink: 0; width: 58px; font-size: 16px; font-weight: 800; color: var(--kanau-primary); padding-top: 12px; }
    .tl-card { flex: 1; }
    .tl-content { font-size: 15px; color: #4a3428; white-space: pre-wrap; }
    .tl-actions { display: flex; gap: 12px; margin-top: 8px; }
    .link-btn { border: none; background: transparent; color: var(--kanau-primary); font-size: 13px; cursor: pointer; padding: 0; }
    .link-btn.danger { color: #e84040; }
    .edit-area { margin-top: 8px; border-radius: 8px; }
    .btn-row { display: flex; gap: 8px; margin-top: 8px; }
    .empty-card { text-align: center; color: #b0a094; padding: 26px 14px; }
  `]
})
export class TimelinePage implements OnInit {
  private api = inject(ApiService);
  private message = inject(NzMessageService);

  readonly loading = signal(true);
  readonly entries = signal<TimelineEntryDto[]>([]);
  readonly editingId = signal<string | null>(null);

  newYear = new Date().getFullYear() + 1;
  newContent = '';
  editYear = 2030;
  editContent = '';

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.api.listTimeline().subscribe({
      next: (list) => {
        this.entries.set([...list].sort((a, b) => a.year - b.year));
        this.loading.set(false);
      },
      error: () => this.loading.set(false)
    });
  }

  add(): void {
    const content = this.newContent.trim();
    if (!content) return;
    this.api.createTimeline({ year: this.newYear, content }).subscribe({
      next: () => {
        this.newContent = '';
        this.message.success('已添加到未来年表 ✨');
        this.load();
      },
      error: () => this.message.error('添加失败，请重试')
    });
  }

  startEdit(e: TimelineEntryDto): void {
    this.editingId.set(e.id);
    this.editYear = e.year;
    this.editContent = e.content;
  }

  saveEdit(e: TimelineEntryDto): void {
    const content = this.editContent.trim();
    if (!content) return;
    this.api.updateTimeline(e.id, { year: this.editYear, content, dreamId: e.dreamId }).subscribe({
      next: () => {
        this.editingId.set(null);
        this.load();
      },
      error: () => this.message.error('保存失败，请重试')
    });
  }

  remove(e: TimelineEntryDto): void {
    this.api.deleteTimeline(e.id).subscribe({
      next: () => this.entries.set(this.entries().filter((x) => x.id !== e.id)),
      error: () => this.message.error('删除失败，请重试')
    });
  }
}
