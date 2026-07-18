function reindexItems(selector, prefix, countId) {
  const items = document.querySelectorAll(selector);
  items.forEach((item, index) => {
    item.dataset.index = String(index);
    const numberEl = item.querySelector('.dynamic-number');
    if (numberEl) {
      numberEl.textContent = String(index + 1);
    }

    item.querySelectorAll('input, textarea').forEach((field) => {
      const name = field.getAttribute('name');
      if (!name) {
        return;
      }
      field.setAttribute('name', name.replace(/_(\d+)$/, `_${index}`));
      if (name.startsWith(`${prefix}Order_`) && !field.value) {
        field.value = String(index);
      }
    });
  });

  const countField = document.getElementById(countId);
  if (countField) {
    countField.value = String(items.length);
  }
}

function bindRemoveHandlers(containerSelector, itemSelector, prefix, countId) {
  const container = document.querySelector(containerSelector);
  if (!container) {
    return;
  }

  container.querySelectorAll('.dynamic-remove').forEach((button) => {
    button.onclick = () => {
      button.closest(itemSelector).remove();
      reindexItems(itemSelector, prefix, countId);
    };
  });
}

function addDynamicCard(target) {
  const isMilestone = target === 'milestones';
  const list = document.getElementById(isMilestone ? 'milestone-list' : 'obstacle-list');
  const template = document.getElementById(isMilestone ? 'milestone-template' : 'obstacle-template');
  const countField = document.getElementById(isMilestone ? 'milestone-count' : 'obstacle-count');
  const index = Number(countField.value || 0);
  const markup = template.innerHTML
    .replaceAll('__INDEX__', String(index))
    .replaceAll('__NUMBER__', String(index + 1));

  list.insertAdjacentHTML('beforeend', markup);
  reindexItems(isMilestone ? '.milestone-item' : '.obstacle-item', isMilestone ? 'milestone' : 'obstacle', isMilestone ? 'milestone-count' : 'obstacle-count');
  bindRemoveHandlers(isMilestone ? '#milestone-list' : '#obstacle-list', isMilestone ? '.milestone-item' : '.obstacle-item', isMilestone ? 'milestone' : 'obstacle', isMilestone ? 'milestone-count' : 'obstacle-count');
}

document.querySelectorAll('.dynamic-add').forEach((button) => {
  button.addEventListener('click', () => addDynamicCard(button.dataset.target));
});

bindRemoveHandlers('#milestone-list', '.milestone-item', 'milestone', 'milestone-count');
bindRemoveHandlers('#obstacle-list', '.obstacle-item', 'obstacle', 'obstacle-count');
reindexItems('.milestone-item', 'milestone', 'milestone-count');
reindexItems('.obstacle-item', 'obstacle', 'obstacle-count');
