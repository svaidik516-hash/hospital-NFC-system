/**
 * MediScan NFC - Universal Glassmorphism Dialog System (Pan-Software)
 * Replaces browser native confirm() and alert() dialogs with modern,
 * accessible, glassmorphic UI modals.
 */

(function () {
  'use strict';

  let dialogOverlay = null;
  let dialogCard = null;
  let dialogIconWrap = null;
  let dialogIcon = null;
  let dialogTitle = null;
  let dialogMessage = null;
  let dialogActions = null;
  let currentResolve = null;

  function ensureDialogDOM() {
    if (document.getElementById('glassDialogOverlay')) {
      dialogOverlay = document.getElementById('glassDialogOverlay');
      dialogCard = dialogOverlay.querySelector('.glass-dialog-card');
      dialogIconWrap = dialogOverlay.querySelector('.glass-dialog-icon-wrap');
      dialogIcon = dialogIconWrap.querySelector('i');
      dialogTitle = dialogOverlay.querySelector('.glass-dialog-title');
      dialogMessage = dialogOverlay.querySelector('.glass-dialog-message');
      dialogActions = dialogOverlay.querySelector('.glass-dialog-actions');
      return;
    }

    dialogOverlay = document.createElement('div');
    dialogOverlay.id = 'glassDialogOverlay';
    dialogOverlay.className = 'glass-dialog-overlay';
    dialogOverlay.setAttribute('role', 'dialog');
    dialogOverlay.setAttribute('aria-modal', 'true');
    dialogOverlay.setAttribute('aria-hidden', 'true');

    dialogOverlay.innerHTML = `
      <div class="glass-dialog-card">
        <div class="glass-dialog-icon-wrap danger">
          <i class="fas fa-exclamation-triangle"></i>
        </div>
        <h3 class="glass-dialog-title">Confirmation</h3>
        <p class="glass-dialog-message">Are you sure you want to proceed?</p>
        <div class="glass-dialog-actions">
          <button type="button" class="glass-dialog-btn glass-dialog-btn-cancel" id="glassDialogBtnCancel">
            <i class="fas fa-times"></i> Cancel
          </button>
          <button type="button" class="glass-dialog-btn glass-dialog-btn-danger" id="glassDialogBtnConfirm">
            <i class="fas fa-check"></i> Confirm
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(dialogOverlay);

    dialogCard = dialogOverlay.querySelector('.glass-dialog-card');
    dialogIconWrap = dialogOverlay.querySelector('.glass-dialog-icon-wrap');
    dialogIcon = dialogIconWrap.querySelector('i');
    dialogTitle = dialogOverlay.querySelector('.glass-dialog-title');
    dialogMessage = dialogOverlay.querySelector('.glass-dialog-message');
    dialogActions = dialogOverlay.querySelector('.glass-dialog-actions');

    // Close when clicking outside the card on the backdrop
    dialogOverlay.addEventListener('click', (e) => {
      if (e.target === dialogOverlay) {
        closeDialog(false);
      }
    });

    // Keydown handler: Escape to cancel, Enter to confirm
    window.addEventListener('keydown', (e) => {
      if (!dialogOverlay || !dialogOverlay.classList.contains('active')) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        closeDialog(false);
      }
    });
  }

  function closeDialog(result) {
    if (!dialogOverlay || !dialogOverlay.classList.contains('active')) return;

    dialogOverlay.classList.remove('active');
    dialogOverlay.setAttribute('aria-hidden', 'true');

    if (currentResolve) {
      const resolve = currentResolve;
      currentResolve = null;
      setTimeout(() => {
        resolve(result);
      }, 150);
    }
  }

  /**
   * Show a modern confirmation dialog.
   * @param {Object} options
   * @param {string} options.title - Dialog title
   * @param {string} options.message - Dialog message (HTML supported)
   * @param {string} [options.confirmText="Confirm"] - Text for confirm button
   * @param {string} [options.cancelText="Cancel"] - Text for cancel button
   * @param {'danger'|'warning'|'info'|'success'} [options.type="danger"] - Visual theme
   * @param {string} [options.icon] - FontAwesome icon class
   * @returns {Promise<boolean>}
   */
  function showConfirmDialog(options = {}) {
    return new Promise((resolve) => {
      ensureDialogDOM();
      currentResolve = resolve;

      const title = options.title || 'Confirm Action';
      const message = options.message || 'Are you sure you want to proceed?';
      const confirmText = options.confirmText || 'Confirm';
      const cancelText = options.cancelText || 'Cancel';
      const type = options.type || 'danger'; // 'danger', 'warning', 'info', 'success'

      let defaultIcon = 'fas fa-exclamation-triangle';
      let confirmBtnClass = 'glass-dialog-btn-danger';
      let confirmIcon = 'fas fa-check';

      if (type === 'danger') {
        defaultIcon = 'fas fa-trash-alt';
        confirmBtnClass = 'glass-dialog-btn-danger';
        confirmIcon = 'fas fa-trash-alt';
      } else if (type === 'warning') {
        defaultIcon = 'fas fa-exclamation-triangle';
        confirmBtnClass = 'glass-dialog-btn-warning';
        confirmIcon = 'fas fa-check';
      } else if (type === 'info') {
        defaultIcon = 'fas fa-info-circle';
        confirmBtnClass = 'glass-dialog-btn-primary';
        confirmIcon = 'fas fa-check';
      } else if (type === 'success') {
        defaultIcon = 'fas fa-clipboard-check';
        confirmBtnClass = 'glass-dialog-btn-success';
        confirmIcon = 'fas fa-check';
      }

      const iconClass = options.icon || defaultIcon;

      // Update contents
      dialogIconWrap.className = `glass-dialog-icon-wrap ${type}`;
      dialogIcon.className = iconClass;
      dialogTitle.textContent = title;
      dialogMessage.innerHTML = message;

      dialogActions.innerHTML = `
        <button type="button" class="glass-dialog-btn glass-dialog-btn-cancel" id="glassDialogBtnCancel">
          <i class="fas fa-times"></i> ${cancelText}
        </button>
        <button type="button" class="glass-dialog-btn ${confirmBtnClass}" id="glassDialogBtnConfirm">
          <i class="${confirmIcon}"></i> ${confirmText}
        </button>
      `;

      const btnCancel = dialogActions.querySelector('#glassDialogBtnCancel');
      const btnConfirm = dialogActions.querySelector('#glassDialogBtnConfirm');

      btnCancel.onclick = () => closeDialog(false);
      btnConfirm.onclick = () => closeDialog(true);

      dialogOverlay.classList.add('active');
      dialogOverlay.setAttribute('aria-hidden', 'false');

      // Autofocus cancel on destructive actions to prevent accidental deletion
      if (type === 'danger') {
        setTimeout(() => btnCancel.focus(), 50);
      } else {
        setTimeout(() => btnConfirm.focus(), 50);
      }
    });
  }

  /**
   * Show a warning or alert dialog (single OK button).
   * @param {Object} options
   */
  function showWarningDialog(options = {}) {
    return new Promise((resolve) => {
      ensureDialogDOM();
      currentResolve = resolve;

      const title = options.title || 'Attention Required';
      const message = options.message || 'Please review this notice.';
      const buttonText = options.buttonText || 'I Understand';
      const type = options.type || 'warning';

      dialogIconWrap.className = `glass-dialog-icon-wrap ${type}`;
      dialogIcon.className = options.icon || (type === 'danger' ? 'fas fa-exclamation-circle' : 'fas fa-exclamation-triangle');
      dialogTitle.textContent = title;
      dialogMessage.innerHTML = message;

      dialogActions.innerHTML = `
        <button type="button" class="glass-dialog-btn ${type === 'danger' ? 'glass-dialog-btn-danger' : 'glass-dialog-btn-primary'}" id="glassDialogBtnConfirm" style="flex: 1;">
          <i class="fas fa-check"></i> ${buttonText}
        </button>
      `;

      const btnConfirm = dialogActions.querySelector('#glassDialogBtnConfirm');
      btnConfirm.onclick = () => closeDialog(true);

      dialogOverlay.classList.add('active');
      dialogOverlay.setAttribute('aria-hidden', 'false');
      setTimeout(() => btnConfirm.focus(), 50);
    });
  }

  // Export globally for whole software
  window.showConfirmDialog = showConfirmDialog;
  window.showWarningDialog = showWarningDialog;
  window.showAlertDialog = showWarningDialog;
  window.confirmAsync = showConfirmDialog;
  window.alertAsync = showWarningDialog;

  window.GlassDialog = {
    confirm: showConfirmDialog,
    warning: showWarningDialog,
    alert: showWarningDialog
  };

  // Auto initialize DOM when document is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureDialogDOM);
  } else {
    ensureDialogDOM();
  }
})();
