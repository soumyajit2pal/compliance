import { esc } from './components.ts';
import { icon } from './icons.ts';
import { dashboardInfo } from './dashboard-info.ts';

export interface DashboardTile {
  title: string;
  href: string;
  symbol: string;
  count?: number;
  selected?: boolean;
  tone?: 'neutral' | 'attention';
  description?: string;
  explanation: string;
}

export function dashboardTiles(label: string, tiles: DashboardTile[]) {
  return `<nav class="dashboard-tiles" aria-label="${esc(label)}">${tiles.map(tile => `
    <div class="dashboard-tile-frame">
    <a class="dashboard-tile" href="#${esc(tile.href)}" data-tone="${tile.tone || 'neutral'}"${tile.selected ? ' aria-current="true"' : ''}>
      <span class="dashboard-tile-heading"><span>${esc(tile.title)}</span><span class="dashboard-tile-icon">${icon(tile.symbol)}</span></span>
      ${tile.count === undefined ? '' : `<strong class="dashboard-tile-count">${esc(tile.count)}</strong>`}
      <span class="dashboard-tile-foot">${esc(tile.description || (tile.selected ? 'Showing records' : 'View records'))}${icon('arrow')}</span>
    </a>${dashboardInfo(tile.title,tile.explanation)}</div>`).join('')}</nav>`;
}
