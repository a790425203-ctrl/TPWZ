'use strict';

/**
 * 全局默认配置。
 * 管理员可在后台（/admin）修改并持久化到 voting_activity 表。
 * 网站所有面向用户的文案均为英文；代码注释使用中文便于维护者阅读。
 */

const DEFAULT_CONFIG = {
  site_title: 'Meeting room name voting',
  // 需要选出的会议室总数量（用于投票结束后的公告文案，不参与投票逻辑）
  total_meeting_rooms: 7,
  // 每个主题最多勾选的预设候选数量
  max_preset_per_theme: 5,
  // 每个主题每人最多有效提名数量
  max_nominations_per_theme: 2,
  // 每个主题提供的提名输入框数量（非必填，只取前 N 个非空）
  max_nomination_inputs: 5,
  // 星系主题 10 个预设候选
  galaxy_presets: [
    'Nebula', 'Star-Ring', 'Orion', 'Sirius', 'Milky-Way',
    'Comet-Glow', 'Pleiades', 'Stardust', 'Deep-Space', 'Flare',
  ],
  // 自然景观主题 10 个预设候选（不含地域地名）
  landscape_presets: [
    'Mountain Range', 'River', 'Grand Canyon', 'Glacier', 'Ocean',
    'Sea of Clouds', 'Peaks', 'Mountain Stream', 'Wasteland', 'Aurora',
  ],
  // 默认让活动处于“进行中”：开始时间在过去、结束时间在很远的未来
  voting_start_at: '2026-01-01T00:00:00.000Z',
  voting_end_at: '2099-12-31T23:59:59.000Z',
};

// URL 中的主题键 → 数据库中存储的主题类型
const THEME_TYPES = {
  galaxy: 'Galaxy',
  landscape: 'NaturalLandscape',
};

module.exports = { DEFAULT_CONFIG, THEME_TYPES };
