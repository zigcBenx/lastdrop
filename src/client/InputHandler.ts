import { Socket } from 'socket.io-client';
import { InputState } from '../shared/types';

export class InputHandler {
  private state: InputState = {
    forward: false,
    backward: false,
    left: false,
    right: false,
  };
  private prevState: string = '';
  private socket: Socket;

  constructor(socket: Socket) {
    this.socket = socket;

    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
  }

  private onKey(e: KeyboardEvent, pressed: boolean): void {
    let changed = false;

    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        if (this.state.forward !== pressed) {
          this.state.forward = pressed;
          changed = true;
        }
        break;
      case 'KeyS':
      case 'ArrowDown':
        if (this.state.backward !== pressed) {
          this.state.backward = pressed;
          changed = true;
        }
        break;
      case 'KeyA':
      case 'ArrowLeft':
        if (this.state.left !== pressed) {
          this.state.left = pressed;
          changed = true;
        }
        break;
      case 'KeyD':
      case 'ArrowRight':
        if (this.state.right !== pressed) {
          this.state.right = pressed;
          changed = true;
        }
        break;
    }

    if (changed) {
      // Prevent default for game keys
      e.preventDefault();
      // Only emit when input actually changes
      const serialized = JSON.stringify(this.state);
      if (serialized !== this.prevState) {
        this.prevState = serialized;
        this.socket.emit('input', this.state);
      }
    }
  }

  getState(): InputState {
    return { ...this.state };
  }
}
