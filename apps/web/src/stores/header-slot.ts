import { create } from 'zustand';

interface HeaderSlotStore {
  slotEl: HTMLElement | null;
  setSlotEl: (el: HTMLElement | null) => void;
}

export const useHeaderSlotStore = create<HeaderSlotStore>((set) => ({
  slotEl: null,
  setSlotEl: (el) => set({ slotEl: el }),
}));
