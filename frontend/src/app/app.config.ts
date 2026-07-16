import { ApplicationConfig, LOCALE_ID, provideBrowserGlobalErrorListeners, isDevMode } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import zh from '@angular/common/locales/zh';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { provideNzI18n, zh_CN } from 'ng-zorro-antd/i18n';
import { provideNzIcons } from 'ng-zorro-antd/icon';
import {
  AimOutline, ArrowLeftOutline, AudioOutline, BulbOutline, CalendarOutline, CameraOutline,
  CheckCircleFill, CheckCircleOutline, CheckOutline, ClockCircleOutline, CloseCircleFill,
  CloseCircleOutline, CloseOutline, DeleteOutline, DoubleLeftOutline, DoubleRightOutline,
  DownOutline, EditOutline, EnvironmentOutline, ExclamationCircleFill, EyeInvisibleOutline,
  EyeOutline, FormOutline, HistoryOutline, HomeOutline, InfoCircleFill, LeftOutline,
  LoadingOutline, LockOutline, LogoutOutline, PlusOutline, QuestionCircleOutline,
  ReloadOutline, RightOutline, RobotOutline, SearchOutline, SendOutline, StarFill,
  StarOutline, SwapRightOutline, UpOutline, UserOutline, VideoCameraOutline
} from '@ant-design/icons-angular/icons';

import { routes } from './app.routes';
import { authInterceptor } from './core/auth.interceptor';

registerLocaleData(zh);

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: LOCALE_ID, useValue: 'zh' },
    provideRouter(routes),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideNzI18n(zh_CN),
    provideNzIcons([
      AimOutline, ArrowLeftOutline, AudioOutline, BulbOutline, CalendarOutline, CameraOutline,
      CheckCircleFill, CheckCircleOutline, CheckOutline, ClockCircleOutline, CloseCircleFill,
      CloseCircleOutline, CloseOutline, DeleteOutline, DoubleLeftOutline, DoubleRightOutline,
      DownOutline, EditOutline, EnvironmentOutline, ExclamationCircleFill, EyeInvisibleOutline,
      EyeOutline, FormOutline, HistoryOutline, HomeOutline, InfoCircleFill, LeftOutline,
      LoadingOutline, LockOutline, LogoutOutline, PlusOutline, QuestionCircleOutline,
      ReloadOutline, RightOutline, RobotOutline, SearchOutline, SendOutline, StarFill,
      StarOutline, SwapRightOutline, UpOutline, UserOutline, VideoCameraOutline
    ]),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
