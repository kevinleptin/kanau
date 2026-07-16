import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterOutlet } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { filter } from 'rxjs/operators';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  private sw = inject(SwUpdate);
  private destroyRef = inject(DestroyRef);

  protected readonly updateReady = signal(false);

  constructor() {
    if (this.sw.isEnabled) {
      this.sw.versionUpdates
        .pipe(
          filter((e) => e.type === 'VERSION_READY'),
          takeUntilDestroyed(this.destroyRef)
        )
        .subscribe(() => this.updateReady.set(true));

      const onVisible = () => {
        if (document.visibilityState === 'visible') {
          this.sw.checkForUpdate().catch(() => void 0);
        }
      };
      document.addEventListener('visibilitychange', onVisible);
      const timer = setInterval(() => this.sw.checkForUpdate().catch(() => void 0), 30 * 60 * 1000);
      this.destroyRef.onDestroy(() => {
        document.removeEventListener('visibilitychange', onVisible);
        clearInterval(timer);
      });
    }
  }

  protected reload(): void {
    document.location.reload();
  }
}
