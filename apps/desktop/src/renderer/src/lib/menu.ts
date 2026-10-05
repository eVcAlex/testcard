/** Room a kebab menu needs below its button; less than this and it opens upward instead of being cut off. */
const MENU_ROOM_PX = 280;

export function opensUp(button: HTMLElement | null): boolean {
  return button !== null && button.getBoundingClientRect().bottom + MENU_ROOM_PX > window.innerHeight;
}
