// content.js
document.addEventListener('paste', function (e) {
  // 如果事件已经被标记为处理过，直接放行
  if (e.__isHandled || e.__isSynthesized) {
    return;
  }

  const target = e.target;
  const isEditable = target.tagName === 'TEXTAREA' ||
    target.tagName === 'INPUT' ||
    target.isContentEditable;

  if (!isEditable) return;

  const cb = e.clipboardData;
  if (!cb) return;

  const text = cb.getData('text/plain');
  const html = cb.getData('text/html');

  // 提取真正的图片文件
  const items = Array.from(cb.items || []);
  let imageFiles = items
    .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
    .map(item => item.getAsFile())
    .filter(f => f !== null);

  // 【核心修复：防“脏图片”】
  // Mac 系统或特定富文本编辑器在复制“纯文字”时，经常会同时在剪贴板里生成一张不可见的“文字快照图”。
  // 这会导致各大 AI 框架（如 GPT）把纯文字误认为上传了一张图片！
  // 识别方法：如果存在 HTML 数据，但 HTML 源码里根本没有任何图片相关的标签，说明这些文件是“虚假伴生图”，直接丢弃！
  if (html && imageFiles.length > 0) {
    const hasImageTag = /<img|<v:imagedata|<v:shape|<figure|<picture|<svg/i.test(html);
    if (!hasImageTag) {
      imageFiles = []; // 清空假图片
    }
  }

  // 1. 完全不处理的内容：空剪贴板
  if (!text.trim() && imageFiles.length === 0) {
    return;
  }

  // 2. 纯图片截图（没有任何实质文字）：不需要改变任何原生默认行为，放行！
  if (!text.trim() && imageFiles.length > 0) {
    return;
  }

  // ===== 以下是包含文字的情况（纯文字，或者真实的图文混合） =====

  // 为了剥离所有多余的 HTML 格式、字体颜色，并将纯文字安全的塞进聊天框，我们阻断原生的插入事件
  e.preventDefault();

  // 首先，由我们亲自动手，把最干净的纯文本安全地插入到输入框当前光标位置！
  if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') {
    const start = target.selectionStart;
    const end = target.selectionEnd;

    // React/Vue 会劫持 input 的 value setter，我们需要绕过它直接操作 DOM 原型上的 setter 才能被成功监听
    const textareaDesc = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value");
    const inputDesc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
    const setter = target.tagName === 'TEXTAREA' ? textareaDesc?.set : inputDesc?.set;

    if (setter) {
      setter.call(target, target.value.substring(0, start) + text + target.value.substring(end));
    } else {
      target.value = target.value.substring(0, start) + text + target.value.substring(end);
    }

    target.selectionStart = target.selectionEnd = start + text.length;
    // 触发 input 事件，告知 React “嘿，用户输入了新文字！”
    target.dispatchEvent(new Event('input', { bubbles: true }));
  } else if (target.isContentEditable) {
    // 很多现代编辑器（比如 Gemini）使用 contenteditable，使用原生 execCommand 是最兼容的
    document.execCommand('insertText', false, text);
  }

  // 【分叉处理】：是否有真实的图片需要发送？

  // 情况 A：这只是一段“纯文字”粘贴
  if (imageFiles.length === 0) {
    // 既然文字我们已经塞进去了，不需要网页的复杂脚本再去瞎折腾了，彻底阻断冒泡！
    e.stopPropagation();
    e.stopImmediatePropagation();
    return;
  }

  // 情况 B：“图文混合”粘贴（这是难点！）
  // 刚才文字我们已经干净地塞进去了，接下来要让网页“自动”把图片传上去。
  // 我们制造一个只有这些图片的“假象”，通过 proxy 劫持抹除掉本来附带的格式，然后把原生事件顺应放上去冒泡！
  const dt = new DataTransfer();
  imageFiles.forEach(file => dt.items.add(file));

  try {
    // 重写当前事件的 clipboardData 属性！
    Object.defineProperty(e, 'clipboardData', {
      value: dt,
      configurable: true,
      enumerable: true
    });
  } catch (err) {
    // 兼容性忽略处理
  }

  e.__isHandled = true;
  // 注意：我们【不调用】 e.stopPropagation() !! 
  // 这起带着“纯净图片（无文字）”的 Paste 事件会继续向网页的上层 React 组件冒泡传递。
  // ChatGPT/Gemini 一旦收到它，读取 clipboardData.files 发现只有图片，就会乖乖地自动上传这批图片，而不会引发文字重复！

}, true);
