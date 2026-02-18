import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  // GET /products -> liste tous les produits
  @Get()
  findAll() {
    return this.productsService.findAll();
  }

  // GET /products/:code -> récupère un produit par son code (p1, p2, p3…)
  @Get(':code')
  findOne(@Param('code') code: string) {
    return this.productsService.findOne(code);
  }

  // POST /products/buy -> acheter un produit
  //
  // body JSON exemple :
  // { "productId": "p1", "quantity": 1 }
  @Post('buy')
  buy(
    @Body('productId') productId: string,
    @Body('quantity') quantity: number,
  ) {
    return this.productsService.buyProduct(productId, Number(quantity));
  }

  // POST /products -> créer un produit
  //
  // body JSON exemple :
  // {
  //   "code": "p4",
  //   "name": "Carte X",
  //   "description": "carte cadeau X",
  //   "priceCents": 1500
  // }
  @Post()
  create(@Body() body: any) {
    const { code, name, description, priceCents } = body;

    return this.productsService.create({
      code,
      name,
      description,
      priceCents: Number(priceCents),
    });
  }
}
