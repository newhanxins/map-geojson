/**
 * 图层编辑管理器
 * 处理区域的编辑操作：拖动、删除、重置、撤销
 */

import type { GeoLayer, GeoJSONFeature, GeoJSONFeatureCollection } from './types';

/** 编辑操作记录（用于撤销） */
interface EditOperation {
  type: 'modify' | 'delete' | 'add';
  featureIndex: number;
  oldFeature?: GeoJSONFeature;
  newFeature?: GeoJSONFeature;
  timestamp: number;
}

/** 右键菜单项 */
export interface ContextMenuItem {
  label: string;
  icon: string;
  action: string;
  disabled?: boolean;
  separator?: boolean;
}

export class EditManager {
  private editHistory: Map<string, EditOperation[]> = new Map();
  private redoHistory: Map<string, EditOperation[]> = new Map();
  private maxHistory = 50; // 最多保存 50 步操作
  private isEditMode = false;

  constructor() {}

  /** 切换编辑模式 */
  toggleEditMode(): boolean {
    this.isEditMode = !this.isEditMode;
    return this.isEditMode;
  }

  /** 获取编辑模式状态 */
  getEditMode(): boolean {
    return this.isEditMode;
  }

  /** 获取右键菜单项 */
  getContextMenuItems(layerId: string, featureIndex: number): ContextMenuItem[] {
    const history = this.editHistory.get(layerId) || [];
    const canUndo = history.length > 0;

    return [
      {
        label: '编辑顶点',
        icon: '✏️',
        action: 'edit-vertices',
      },
      {
        label: '添加顶点',
        icon: '➕',
        action: 'add-vertex',
      },
      {
        label: '移动区域',
        icon: '↔️',
        action: 'move-feature',
      },
      { separator: true, label: '', icon: '', action: '' },
      {
        label: '删除区域',
        icon: '🗑️',
        action: 'delete-feature',
      },
      { separator: true, label: '', icon: '', action: '' },
      {
        label: '重置源数据',
        icon: '🔄',
        action: 'reset-feature',
      },
      {
        label: `撤销 (剩余 ${history.length} 步)`,
        icon: '↩️',
        action: 'undo',
        disabled: !canUndo,
      },
    ];
  }

  /** 记录编辑操作 */
  recordEdit(layerId: string, operation: EditOperation): void {
    if (!this.editHistory.has(layerId)) {
      this.editHistory.set(layerId, []);
    }

    const history = this.editHistory.get(layerId)!;
    history.push(operation);

    // 限制历史记录数量
    if (history.length > this.maxHistory) {
      history.shift();
    }

    // 新操作清空重做历史
    this.redoHistory.delete(layerId);
  }

  /** 撤销上一步操作 */
  undo(layerId: string, layer: GeoLayer): GeoJSONFeatureCollection | null {
    const history = this.editHistory.get(layerId);
    if (!history || history.length === 0) {
      return null;
    }

    const lastOp = history.pop()!;
    const data = layer.simplifiedData || layer.data;

    switch (lastOp.type) {
      case 'modify':
        // 恢复修改前的要素
        if (lastOp.oldFeature) {
          data.features[lastOp.featureIndex] = lastOp.oldFeature;
        }
        break;

      case 'delete':
        // 恢复删除的要素
        if (lastOp.oldFeature) {
          data.features.splice(lastOp.featureIndex, 0, lastOp.oldFeature);
        }
        break;

      case 'add':
        // 删除新增的要素
        data.features.splice(lastOp.featureIndex, 1);
        break;
    }

    // 添加到重做历史
    if (!this.redoHistory.has(layerId)) {
      this.redoHistory.set(layerId, []);
    }
    this.redoHistory.get(layerId)!.push(lastOp);

    return data;
  }

  /** 重做上一步撤销的操作 */
  redo(layerId: string, layer: GeoLayer): GeoJSONFeatureCollection | null {
    const redoHist = this.redoHistory.get(layerId);
    if (!redoHist || redoHist.length === 0) {
      return null;
    }

    const op = redoHist.pop()!;
    const data = layer.simplifiedData || layer.data;

    switch (op.type) {
      case 'modify':
        // 重新应用修改
        if (op.newFeature) {
          data.features[op.featureIndex] = op.newFeature;
        }
        break;

      case 'delete':
        // 重新删除
        data.features.splice(op.featureIndex, 1);
        break;

      case 'add':
        // 重新添加
        if (op.newFeature) {
          data.features.splice(op.featureIndex, 0, op.newFeature);
        }
        break;
    }

    // 添加回撤销历史
    if (!this.editHistory.has(layerId)) {
      this.editHistory.set(layerId, []);
    }
    this.editHistory.get(layerId)!.push(op);

    return data;
  }

  /** 删除区域 */
  deleteFeature(layerId: string, layer: GeoLayer, featureIndex: number): GeoJSONFeatureCollection | null {
    const data = layer.simplifiedData || layer.data;
    if (featureIndex < 0 || featureIndex >= data.features.length) {
      return null;
    }

    const oldFeature = data.features[featureIndex];

    // 记录操作
    this.recordEdit(layerId, {
      type: 'delete',
      featureIndex,
      oldFeature,
      timestamp: Date.now(),
    });

    // 删除要素
    data.features.splice(featureIndex, 1);

    return data;
  }

  /** 重置区域到源数据 */
  resetFeature(
    layerId: string,
    layer: GeoLayer,
    featureIndex: number,
    originalData: GeoJSONFeatureCollection
  ): GeoJSONFeatureCollection | null {
    const currentData = layer.simplifiedData || layer.data;
    if (featureIndex < 0 || featureIndex >= currentData.features.length) {
      return null;
    }

    const oldFeature = currentData.features[featureIndex];
    const originalFeature = originalData.features[featureIndex];

    if (!originalFeature) {
      return null;
    }

    // 记录操作
    this.recordEdit(layerId, {
      type: 'modify',
      featureIndex,
      oldFeature,
      newFeature: originalFeature,
      timestamp: Date.now(),
    });

    // 重置为源数据
    currentData.features[featureIndex] = { ...originalFeature };

    return currentData;
  }

  /** 更新要素几何（拖动顶点后） */
  updateFeatureGeometry(
    layerId: string,
    layer: GeoLayer,
    featureIndex: number,
    newGeometry: any
  ): GeoJSONFeatureCollection | null {
    const data = layer.simplifiedData || layer.data;
    if (featureIndex < 0 || featureIndex >= data.features.length) {
      return null;
    }

    const oldFeature = { ...data.features[featureIndex] };
    const newFeature = {
      ...oldFeature,
      geometry: newGeometry,
    };

    // 记录操作
    this.recordEdit(layerId, {
      type: 'modify',
      featureIndex,
      oldFeature,
      newFeature,
      timestamp: Date.now(),
    });

    // 更新几何
    data.features[featureIndex] = newFeature;

    return data;
  }

  /** 获取历史记录长度 */
  getHistoryLength(layerId: string): number {
    return this.editHistory.get(layerId)?.length || 0;
  }

  /** 获取重做历史长度 */
  getRedoHistoryLength(layerId: string): number {
    return this.redoHistory.get(layerId)?.length || 0;
  }

  /** 清空历史记录 */
  clearHistory(layerId?: string): void {
    if (layerId) {
      this.editHistory.delete(layerId);
      this.redoHistory.delete(layerId);
    } else {
      this.editHistory.clear();
      this.redoHistory.clear();
    }
  }
}
