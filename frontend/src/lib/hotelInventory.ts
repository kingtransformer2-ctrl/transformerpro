
import { getLocalData, saveLocalData } from './localDataService';

// Function to get a service menu item by id
async function getLocalServiceMenuItem(serviceItemId: string) {
  const serviceMenuItems = await getLocalData<any>('hotel_service_menu');
  return serviceMenuItems.find(item => item.id === serviceItemId) || null;
}

// Function to get a recipe for a service item
async function getLocalServiceItemRecipe(serviceItemId: string) {
  const recipes = await getLocalData<any>('hotel_service_item_recipes');
  return recipes.filter(recipe => recipe.service_item_id === serviceItemId);
}

// Function to get inventory locations for an ingredient
async function getLocalInventoryLocations(ingredientId: string) {
  const locations = await getLocalData<any>('hotel_inventory_item_locations');
  return locations.filter(loc => loc.ingredient_id === ingredientId);
}

// Function to deduct inventory locally
export async function deductLocalInventoryForOrderItem(orderItem: any) {
  try {
    // Check if inventory_deducted is already true
    if (orderItem.inventory_deducted) {
      return;
    }

    if (!orderItem.service_item_id) {
      return;
    }

    const serviceItem = await getLocalServiceMenuItem(orderItem.service_item_id);
    if (!serviceItem || !serviceItem.track_stock) {
      return;
    }

    const locationCode = serviceItem.inventory_source_location === 'bar' ? 'bar' : 'kitchen';
    let deductedAny = false;

    // Check if we need to use recipe or direct ingredient
    const recipes = await getLocalServiceItemRecipe(orderItem.service_item_id);
    const hasRecipes = recipes.length > 0 && recipes.some(r => r.ingredient_id);
    const useRecipe = serviceItem.use_recipe || hasRecipes;

    if (useRecipe) {
      // Process each recipe item
      for (const recipe of recipes) {
        if (!recipe.ingredient_id) continue;

        const totalQuantity = (recipe.quantity_required || 0) * (orderItem.quantity || 0);
        if (totalQuantity <= 0) continue;

        deductedAny = true;
        await deductLocalIngredientInventory(
          recipe.ingredient_id,
          locationCode,
          totalQuantity,
          orderItem,
          serviceItem
        );
      }
    } else if (serviceItem.direct_ingredient_id) {
      // Direct ingredient
      deductedAny = true;
      await deductLocalIngredientInventory(
        serviceItem.direct_ingredient_id,
        locationCode,
        orderItem.quantity || 0,
        orderItem,
        serviceItem
      );
    }

    // Update order item to mark inventory as deducted
    orderItem.inventory_deducted = true;
    orderItem.inventory_consumed_at = new Date().toISOString();
    await saveLocalData('hotel_order_items', orderItem);

    // Update service menu item's display stock
    if (serviceItem) {
      await updateLocalServiceMenuStock(orderItem.service_item_id);
    }
  } catch (error) {
    console.error('Error deducting local inventory:', error);
  }
}

// Helper function to deduct from an ingredient's inventory
async function deductLocalIngredientInventory(
  ingredientId: string,
  locationCode: string,
  quantityToDeduct: number,
  orderItem: any,
  serviceItem: any
) {
  // Get current inventory locations
  const allLocations = await getLocalData<any>('hotel_inventory_item_locations');
  const location = allLocations.find(
    loc => loc.ingredient_id === ingredientId && loc.location_code === locationCode
  );

  if (location) {
    // Deduct from the location
    location.quantity = Math.max(0, (location.quantity || 0) - quantityToDeduct);
    await saveLocalData('hotel_inventory_item_locations', location);

    // Update ingredient's total stock
    await updateLocalIngredientStock(ingredientId);

    // Create a local movement record
    const movements = await getLocalData<any>('hotel_ingredient_movements');
    const newMovement = {
      id: crypto.randomUUID(),
      ingredient_id: ingredientId,
      movement_type: 'out',
      quantity: quantityToDeduct,
      reason: `Order placed: ${orderItem.name}`,
      reference_id: orderItem.order_id,
      notes: 'Automatic local deduction',
      location_code: locationCode,
      movement_scope: 'menu',
      service_item_id: serviceItem.id,
      order_item_id: orderItem.id,
      station: orderItem.station,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    movements.push(newMovement);
    await saveLocalData('hotel_ingredient_movements', movements);
  }
}

// Update service menu item's display stock
async function updateLocalServiceMenuStock(serviceItemId: string) {
  const serviceMenuItems = await getLocalData<any>('hotel_service_menu');
  const serviceItem = serviceMenuItems.find(item => item.id === serviceItemId);
  if (!serviceItem) return;

  if (!serviceItem.track_stock) {
    serviceItem.stock_quantity = 0;
    serviceItem.updated_at = new Date().toISOString();
    await saveLocalData('hotel_service_menu', serviceItem);
    return;
  }

  let displayStock = 0;
  const locationCode = serviceItem.inventory_source_location === 'bar' ? 'bar' : 'kitchen';
  const recipes = await getLocalServiceItemRecipe(serviceItemId);
  const hasRecipes = recipes.length > 0 && recipes.some(r => r.ingredient_id);
  const useRecipe = serviceItem.use_recipe || hasRecipes;

  if (useRecipe) {
    // Calculate stock based on recipe
    let minStock = Infinity;
    for (const recipe of recipes) {
      if (!recipe.ingredient_id) continue;

      const ingredientLocations = await getLocalInventoryLocations(recipe.ingredient_id);
      const location = ingredientLocations.find(loc => loc.location_code === locationCode);
      const ingredientStock = location?.quantity || 0;
      const maxOrdersFromIngredient = Math.floor(ingredientStock / Math.max(0.0001, recipe.quantity_required || 0));
      minStock = Math.min(minStock, maxOrdersFromIngredient);
    }
    displayStock = minStock === Infinity ? 0 : minStock;
  } else if (serviceItem.direct_ingredient_id) {
    // Direct ingredient stock
    const ingredientLocations = await getLocalInventoryLocations(serviceItem.direct_ingredient_id);
    const location = ingredientLocations.find(loc => loc.location_code === locationCode);
    displayStock = location?.quantity || 0;
  }

  serviceItem.stock_quantity = displayStock;
  serviceItem.updated_at = new Date().toISOString();
  await saveLocalData('hotel_service_menu', serviceItem);
}

// Update ingredient's total stock
async function updateLocalIngredientStock(ingredientId: string) {
  const ingredients = await getLocalData<any>('hotel_ingredients');
  const ingredient = ingredients.find(ing => ing.id === ingredientId);
  if (!ingredient) return;

  const locations = await getLocalInventoryLocations(ingredientId);
  ingredient.stock_quantity = locations.reduce((sum, loc) => sum + (loc.quantity || 0), 0);
  ingredient.open_unit_volume = locations.reduce((sum, loc) => sum + (loc.open_unit_volume || 0), 0);
  ingredient.empty_units_count = locations.reduce((sum, loc) => sum + (loc.empty_units_count || 0), 0);
  ingredient.updated_at = new Date().toISOString();

  await saveLocalData('hotel_ingredients', ingredient);

  // Also update all service menu items that use this ingredient
  await updateLocalServiceMenuStockByIngredient(ingredientId);
}

// Update all service menu items that use a specific ingredient
async function updateLocalServiceMenuStockByIngredient(ingredientId: string) {
  const serviceMenuItems = await getLocalData<any>('hotel_service_menu');
  const recipes = await getLocalData<any>('hotel_service_item_recipes');

  // Find all service items that use this ingredient
  const serviceItemIds = new Set<string>();

  // Service items with direct ingredient
  serviceMenuItems.forEach(item => {
    if (item.direct_ingredient_id === ingredientId) {
      serviceItemIds.add(item.id);
    }
  });

  // Service items with recipe that uses this ingredient
  recipes.forEach(recipe => {
    if (recipe.ingredient_id === ingredientId) {
      serviceItemIds.add(recipe.service_item_id);
    }
  });

  // Update each service item's stock
  for (const serviceItemId of serviceItemIds) {
    await updateLocalServiceMenuStock(serviceItemId);
  }
}

// Function to restore local inventory when an order item is cancelled
export async function restoreLocalInventoryForOrderItem(orderItem: any) {
  try {
    if (!orderItem.service_item_id || !orderItem.inventory_deducted || orderItem.inventory_reversed_at) {
      return;
    }

    const serviceItem = await getLocalServiceMenuItem(orderItem.service_item_id);
    if (!serviceItem || !serviceItem.track_stock) {
      return;
    }

    const locationCode = serviceItem.inventory_source_location === 'bar' ? 'bar' : 'kitchen';

    // Process recipe or direct ingredient
    const recipes = await getLocalServiceItemRecipe(orderItem.service_item_id);
    const hasRecipes = recipes.length > 0 && recipes.some(r => r.ingredient_id);
    const useRecipe = serviceItem.use_recipe || hasRecipes;

    if (useRecipe) {
      // Restore each recipe item
      for (const recipe of recipes) {
        if (!recipe.ingredient_id) continue;

        const totalQuantity = (recipe.quantity_required || 0) * (orderItem.quantity || 0);
        if (totalQuantity <= 0) continue;

        await restoreLocalIngredientInventory(
          recipe.ingredient_id,
          locationCode,
          totalQuantity,
          orderItem,
          serviceItem
        );
      }
    } else if (serviceItem.direct_ingredient_id) {
      // Direct ingredient
      await restoreLocalIngredientInventory(
        serviceItem.direct_ingredient_id,
        locationCode,
        orderItem.quantity || 0,
        orderItem,
        serviceItem
      );
    }

    // Mark order item as reversed
    orderItem.inventory_reversed_at = new Date().toISOString();
    await saveLocalData('hotel_order_items', orderItem);

    // Update service menu stock
    if (serviceItem) {
      await updateLocalServiceMenuStock(orderItem.service_item_id);
    }
  } catch (error) {
    console.error('Error restoring local inventory:', error);
  }
}

// Helper function to restore ingredient inventory
async function restoreLocalIngredientInventory(
  ingredientId: string,
  locationCode: string,
  quantityToRestore: number,
  orderItem: any,
  serviceItem: any
) {
  // Get current inventory locations
  const allLocations = await getLocalData<any>('hotel_inventory_item_locations');
  const location = allLocations.find(
    loc => loc.ingredient_id === ingredientId && loc.location_code === locationCode
  );

  if (location) {
    // Restore the quantity
    location.quantity = (location.quantity || 0) + quantityToRestore;
    await saveLocalData('hotel_inventory_item_locations', location);

    // Update ingredient's total stock
    await updateLocalIngredientStock(ingredientId);

    // Create a local movement record
    const movements = await getLocalData<any>('hotel_ingredient_movements');
    const newMovement = {
      id: crypto.randomUUID(),
      ingredient_id: ingredientId,
      movement_type: 'in',
      quantity: quantityToRestore,
      reason: `Order cancelled: ${orderItem.name}`,
      reference_id: orderItem.order_id,
      notes: 'Automatic local restoration',
      location_code: locationCode,
      movement_scope: 'menu',
      service_item_id: serviceItem.id,
      order_item_id: orderItem.id,
      station: orderItem.station,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    movements.push(newMovement);
    await saveLocalData('hotel_ingredient_movements', movements);
  }
}
