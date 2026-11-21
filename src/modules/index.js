// src/modules/index.js — static import list of module backends (§4.2)
// Adding a module: import its api.js here, then register routes in src/index.js.

import * as projectsApi from './projects/api.js';
import * as usersApi from './users/api.js';
import * as documentsApi from './documents/api.js';

export const MODULE_APIS = [
  ...projectsApi.routes.map((r) => ({ ...r, moduleKey: 'projects' })),
  ...usersApi.routes.map((r) => ({ ...r, moduleKey: 'users' })),
  ...documentsApi.routes.map((r) => ({ ...r, moduleKey: 'documents' })),
];

export const MODULE_HOOKS = [];
export const MODULE_SERVICES = {};
