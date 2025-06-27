export class Vec2 {
  x: number;
  y: number;

  constructor(x?: number | Vec2, y?: number) {
    if (x && x instanceof Vec2) {
      this.x = x.x;
      this.y = x.y;
    }
    else {
      this.x = x ?? 0;
      this.y = y ?? 0;
    }
  }

  add(other: Vec2): Vec2 {
    return new Vec2(this.x + other.x, this.y + other.y);
  }

  sub(other: Vec2): Vec2 {
    return new Vec2(this.x - other.x, this.y - other.y);
  }

  mul(n: Vec2): Vec2;
  mul(n: number): Vec2;
  mul(n: Vec2 | number) {
    if (typeof n === "number") {
      return new Vec2(this.x * n, this.y * n);
    } else {
      return new Vec2(this.x * n.x, this.y * n.y);
    }
  }

  div(n: number): Vec2;
  div(n: Vec2): Vec2;
  div(n: Vec2 | number): Vec2 {
    if (typeof n === "number") {
      return new Vec2(this.x / n, this.y / n);
    } else {
      return new Vec2(this.x / n.x, this.y / n.y);
    }
  }

  neg(): Vec2 {
    return new Vec2(-this.x, -this.y);
  }

  mag(): number {
    return Math.sqrt(Math.pow(this.x, 2) + Math.pow(this.y, 2));
  }

  round(): Vec2 {
    return new Vec2(Math.round(this.x), Math.round(this.y));
  }

  equal(other: Vec2): boolean {
    return this.x === other.x && this.y === other.y;
  }

  dot(other: Vec2): number {
    return this.x * other.x + this.y * other.y;
  }
}
