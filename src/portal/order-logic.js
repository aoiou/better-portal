(() => {
  "use strict";

  const BP = (globalThis.BetterPortal = globalThis.BetterPortal || {});

  const OrderLogic = {
    calcMoveOrder(order, hiddenIds, cardId, direction) {
      const idx = order.indexOf(cardId);
      if (idx < 0) return null;

      const hiddenSet = new Set(Array.isArray(hiddenIds) ? hiddenIds : []);
      const visibleOrder = order.filter((id) => !hiddenSet.has(id));
      const visibleIdx = visibleOrder.indexOf(cardId);
      if (visibleIdx < 0) return null;

      const newVisibleIdx = visibleIdx + direction;
      if (newVisibleIdx < 0 || newVisibleIdx >= visibleOrder.length) return null;

      const swapId = visibleOrder[newVisibleIdx];
      const swapIdx = order.indexOf(swapId);

      const newOrder = [...order];
      newOrder[idx] = swapId;
      newOrder[swapIdx] = cardId;
      return newOrder;
    },

    calcReorderFromVisible(order, hiddenIds, newVisibleOrder) {
      if (!Array.isArray(order) || !Array.isArray(newVisibleOrder)) return null;
      const hiddenSet = new Set(Array.isArray(hiddenIds) ? hiddenIds : []);
      const visibleSet = new Set(newVisibleOrder);
      let cursor = 0;
      const result = [];
      for (const id of order) {
        if (hiddenSet.has(id) || !visibleSet.has(id)) {
          result.push(id);
        } else if (cursor < newVisibleOrder.length) {
          result.push(newVisibleOrder[cursor++]);
        }
      }
      while (cursor < newVisibleOrder.length) {
        result.push(newVisibleOrder[cursor++]);
      }
      return result;
    },

    reconcileOrder(order, presentIds) {
      const base = Array.isArray(order) ? order : [];
      const allIds = new Set(presentIds);
      const next = base.filter((id) => allIds.has(id));
      const known = new Set(next);
      for (const id of presentIds) {
        if (!known.has(id)) {
          known.add(id);
          next.push(id);
        }
      }
      return next;
    },
  };

  BP.OrderLogic = OrderLogic;
})();
