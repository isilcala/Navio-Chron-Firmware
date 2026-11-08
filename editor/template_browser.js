// 官方模板浏览视图：按应用合并平台变体、工作流分组与搜索；不改变模板身份或记录数据。
(function (root, factory) {
  const api = factory();
  root.NavioTemplateBrowser = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const GROUPS = [
    { id: "video", label: "视频剪辑" },
    { id: "motion", label: "动效 / 3D" },
    { id: "design", label: "矢量 / 修图" },
    { id: "painting", label: "数字绘画" },
    { id: "tools", label: "工具" },
    { id: "other", label: "其他" },
  ];
  const FAMILY_GROUPS = {
    jianying: "video", capcut: "video", resolve: "video", premiere: "video", "final-cut-pro": "video",
    "after-effects": "motion", blender: "motion",
    illustrator: "design", photoshop: "design", "lightroom-classic": "design", "capture-one": "design",
    "clip-studio-paint": "painting", krita: "painting", procreate: "painting",
    "f13-macro": "tools", test: "tools",
  };
  const ALIASES = {
    jianying: ["剪映"], capcut: ["剪映国际版"], resolve: ["达芬奇"], premiere: ["pr"],
    "final-cut-pro": ["fcp", "finalcut"], "after-effects": ["ae"], blender: ["blender3d"],
    illustrator: ["ai"], photoshop: ["ps"], "lightroom-classic": ["lr", "lrc", "lightroom"],
    "capture-one": ["c1"], "clip-studio-paint": ["csp"], krita: ["krita"], procreate: ["procreate"],
    "f13-macro": ["f13", "宏"], test: ["测试"],
  };
  const PLATFORM_TERMS = { win: ["win", "windows"], mac: ["mac", "macos"], ipad: ["ipad", "ipados"] };

  function familyOf(template) {
    return template.templateId.replace(/-(win|mac)$/, "");
  }
  function buildTemplateGroups(templates) {
    const families = new Map();
    for (const template of templates) {
      const family = familyOf(template);
      if (!families.has(family)) families.set(family, { family, name: template.name, variants: [] });
      families.get(family).variants.push(template);
    }
    const groups = new Map(GROUPS.map(group => ({ ...group, items: [] })).map(group => [group.id, group]));
    for (const item of families.values()) {
      const group = FAMILY_GROUPS[item.family] || "other";
      groups.get(group).items.push(item);
    }
    return [...groups.values()].filter(group => group.items.length);
  }
  function filterTemplateGroups(groups, query) {
    const terms = String(query || "").toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!terms.length) return groups;
    return groups.map(group => {
      const items = group.items.filter(item => {
        const platforms = item.variants.flatMap(variant => PLATFORM_TERMS[variant.platform] || [variant.platform]);
        const haystack = [item.name, item.family, group.label, ...ALIASES[item.family] || [], ...platforms]
          .join(" ").toLocaleLowerCase();
        return terms.every(term => haystack.includes(term));
      });
      return { ...group, items };
    }).filter(group => group.items.length);
  }
  function variantForPlatform(item, platform) {
    return item?.variants.find(variant => variant.platform === platform) || item?.variants[0] || null;
  }
  function findTemplateItem(groups, templateId) {
    for (const group of groups) {
      const item = group.items.find(item => item.variants.some(variant => variant.templateId === templateId));
      if (item) return item;
    }
    return null;
  }
  function countTemplateItems(groups) {
    return groups.reduce((count, group) => count + group.items.length, 0);
  }

  return { buildTemplateGroups, filterTemplateGroups, variantForPlatform, findTemplateItem, countTemplateItems };
});
