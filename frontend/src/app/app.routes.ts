import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login').then((m) => m.LoginPage)
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/shell/shell').then((m) => m.ShellPage),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'home' },
      { path: 'home', loadComponent: () => import('./pages/home/home').then((m) => m.HomePage) },
      { path: 'dreams', loadComponent: () => import('./pages/dreams/dreams').then((m) => m.DreamsPage) },
      { path: 'dreams/:id', loadComponent: () => import('./pages/dreams/dream-detail').then((m) => m.DreamDetailPage) },
      { path: 'notes', loadComponent: () => import('./pages/notes/notes').then((m) => m.NotesPage) },
      { path: 'reviews', loadComponent: () => import('./pages/reviews/reviews').then((m) => m.ReviewsPage) },
      { path: 'settings', loadComponent: () => import('./pages/settings/settings').then((m) => m.SettingsPage) },
      { path: 'timeline', loadComponent: () => import('./pages/settings/timeline').then((m) => m.TimelinePage) },
      { path: 'admin/users', loadComponent: () => import('./pages/settings/admin-users').then((m) => m.AdminUsersPage) }
    ]
  },
  { path: '**', redirectTo: '' }
];
