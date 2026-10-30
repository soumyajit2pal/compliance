export interface PortalIdentity {
  csrf_token: string;
  environment: string;
  grants: Array<Record<string, any>>;
  menu: Array<{ id: string; label: string }>;
  roles: string[];
  user: Record<string, any>;
  [key: string]: any;
}

export interface PortalState {
  identity: PortalIdentity | null;
  ready: boolean;
  masters: Record<string, any[]> | null;
  record: Record<string, any> | null;
  batch: Record<string, any> | null;
  routeNumber: number;
  view: Record<string, any>;
  work: any[];
  notifications: any[];
  [key: string]: any;
}

export const state: PortalState = {
  identity: null,
  ready: false,
  masters: null,
  record: null,
  batch: null,
  routeNumber: 0,
  view: {},
  work: [],
  notifications: [],
};
