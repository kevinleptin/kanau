import { Injectable, inject } from '@angular/core';
import { ApiService } from './api.service';

/** 地理位置：仅在用户开启「位置记录」时快速尝试获取，2 秒拿不到就放弃，绝不阻塞。 */
@Injectable({ providedIn: 'root' })
export class GeoService {
  private api = inject(ApiService);

  async tryGet(): Promise<{ lat?: number; lng?: number }> {
    if (!this.api.me()?.locationEnabled) return {};
    if (!('geolocation' in navigator)) return {};
    return new Promise((resolve) => {
      let settled = false;
      const finish = (v: { lat?: number; lng?: number }) => {
        if (!settled) { settled = true; resolve(v); }
      };
      const timer = setTimeout(() => finish({}), 2000);
      navigator.geolocation.getCurrentPosition(
        (p) => { clearTimeout(timer); finish({ lat: p.coords.latitude, lng: p.coords.longitude }); },
        () => { clearTimeout(timer); finish({}); },
        { timeout: 1900, maximumAge: 300000 }
      );
    });
  }
}
